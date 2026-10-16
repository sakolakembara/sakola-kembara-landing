import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLOUDFLARE_RANGES, ZONE, checkZone, isCloudflareAddress, main, parseZoneExport, render } from '../../scripts/check-zone-export.mjs';
import { repoRoot } from './helpers';

// cf/scripts/check-zone-export.mjs (SAKEM-104): the offline check of the dashboard's BIND export of the zone, written after the
// error 1000 incident of 2026-10-15 (the onboarding scan copied Cloudflare's own addresses into A and AAAA records). Every
// export below is invented: documentation addresses (203.0.113.0/24, 198.51.100.0/24, 2001:db8::/32), an invented Microsoft
// 365 tenant, the format of Cloudflare's export (a `cf_tags=cf-proxied:...` comment after each record).

const HEALTHY = `;; SOA Record
sakolakembara.org.\t3600\tIN\tSOA\tada.ns.cloudflare.com. dns.cloudflare.com. 2050000000 10000 2400 604800 3600

;; NS Records
sakolakembara.org.\t86400\tIN\tNS\tada.ns.cloudflare.com.
sakolakembara.org.\t86400\tIN\tNS\tbob.ns.cloudflare.com.

;; A Records
sakolakembara.org.\t1\tIN\tA\t203.0.113.10 ; cf_tags=cf-proxied:true
cpanel.sakolakembara.org.\t1\tIN\tA\t203.0.113.10 ; cf_tags=cf-proxied:false
webmail.sakolakembara.org.\t1\tIN\tA\t203.0.113.10 ; cf_tags=cf-proxied:false

;; AAAA Records
sakolakembara.org.\t1\tIN\tAAAA\t2001:db8::10 ; cf_tags=cf-proxied:true

;; CNAME Records
www.sakolakembara.org.\t1\tIN\tCNAME\tsakolakembara.org. ; cf_tags=cf-proxied:true
autodiscover.sakolakembara.org.\t1\tIN\tCNAME\tautodiscover.outlook.com. ; cf_tags=cf-proxied:false
selector1._domainkey.sakolakembara.org.\t1\tIN\tCNAME\tselector1-sakolakembara-org._domainkey.contoso.onmicrosoft.com. ; cf_tags=cf-proxied:false
selector2._domainkey.sakolakembara.org.\t1\tIN\tCNAME\tselector2-sakolakembara-org._domainkey.contoso.onmicrosoft.com. ; cf_tags=cf-proxied:false
lms.sakolakembara.org.\t1\tIN\tCNAME\tlms.example.test. ; cf_tags=cf-proxied:false

;; MX Records
sakolakembara.org.\t1\tIN\tMX\t0 sakolakembara-org.mail.protection.outlook.com. ; cf_tags=cf-proxied:false

;; TXT Records
sakolakembara.org.\t1\tIN\tTXT\t"v=spf1 include:spf.protection.outlook.com -all" ; cf_tags=cf-proxied:false
_dmarc.sakolakembara.org.\t1\tIN\tTXT\t"v=DMARC1; p=none; rua=mailto:dmarc@sakolakembara.org" ; cf_tags=cf-proxied:false
`;

const levels = (results: { id: string; level: string }[], id: string) => results.filter((r) => r.id === id).map((r) => r.level);
const check = (text: string, options?: { allowWildcard?: boolean }) => checkZone(parseZoneExport(text), options);
const fails = <T extends { level: string }>(results: T[]) => results.filter((r) => r.level === 'FAIL');
const withLines = (...lines: string[]) => `${HEALTHY}${lines.join('\n')}\n`;

describe('reading the export', () => {
  it('reads Cloudflare\'s format: names without the final dot, types, content, and the proxy tag', () => {
    const records = parseZoneExport(HEALTHY);
    expect(records.length).toBe(15);
    const apex = records.find((r) => r.name === ZONE && r.type === 'A')!;
    expect(apex).toEqual({ name: 'sakolakembara.org', type: 'A', rdata: '203.0.113.10', proxied: true });
    expect(records.find((r) => r.name === 'cpanel.sakolakembara.org')!.proxied).toBe(false);
    expect(records.find((r) => r.type === 'MX')!.rdata).toBe('0 sakolakembara-org.mail.protection.outlook.com.');
    expect(records.find((r) => r.type === 'SOA')!.proxied).toBeNull();
  });

  it('a semicolon inside a quoted TXT string is not a comment, and the tag after it is still read', () => {
    const [txt] = parseZoneExport('_dmarc.sakolakembara.org.\t1\tIN\tTXT\t"v=DMARC1; p=none; rua=mailto:a@sakolakembara.org" ; cf_tags=cf-proxied:false\n');
    expect(txt!.rdata).toBe('"v=DMARC1; p=none; rua=mailto:a@sakolakembara.org"');
    expect(txt!.proxied).toBe(false);
  });

  it('tolerates directives, comments, a multi-line record in parentheses, a relative name with $ORIGIN, a blank owner, a missing TTL and class', () => {
    const records = parseZoneExport(
      ['$ORIGIN sakolakembara.org.', '$TTL 300', '; a comment', '@ IN A 203.0.113.9', 'www CNAME @', 'k1._domainkey 1 IN TXT ( "v=DKIM1; k=rsa; "', '  "p=MIGfMA0" ) ; cf_tags=cf-proxied:false', '  1 IN TXT "second"', ''].join('\n'),
    );
    expect(records.map((r) => [r.name, r.type])).toEqual([['sakolakembara.org', 'A'], ['www.sakolakembara.org', 'CNAME'], ['k1._domainkey.sakolakembara.org', 'TXT'], ['k1._domainkey.sakolakembara.org', 'TXT']]);
    expect(records[2]!.rdata).toContain('p=MIGfMA0');
    expect(records[2]!.proxied).toBe(false);
  });
});

describe('Cloudflare\'s own addresses (Z-01, the error 1000 incident)', () => {
  it('every published range is covered: the first and the last address are inside, the neighbours are outside', () => {
    expect(CLOUDFLARE_RANGES.length).toBe(22);
    // the published lists, read on 2026-10-15 (https://www.cloudflare.com/ips-v4 and /ips-v6), as a second copy
    expect([...CLOUDFLARE_RANGES].sort()).toEqual(
      ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22', '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'].sort(),
    );
    for (const inside of ['173.245.48.1', '173.245.63.255', '103.21.244.0', '103.21.247.255', '103.22.203.255', '103.31.7.255', '141.101.127.255', '108.162.255.255', '190.93.255.255', '188.114.111.255', '197.234.243.255', '198.41.128.0', '198.41.255.255', '162.158.0.0', '162.159.255.255', '104.16.0.0', '104.23.255.255', '104.24.0.0', '104.27.255.255', '172.64.0.0', '172.71.255.255', '131.0.72.0', '131.0.75.255']) {
      expect(isCloudflareAddress(inside), inside).toBe(true);
    }
    for (const outside of ['173.245.64.0', '103.21.243.255', '103.21.248.0', '141.101.128.0', '104.15.255.255', '104.28.0.0', '104.32.0.0', '172.63.255.255', '172.72.0.0', '162.160.0.0', '162.157.255.255', '131.0.76.0', '203.0.113.10', '198.51.100.7', '8.8.8.8', '1.1.1.1', '0.0.0.0', '255.255.255.255']) {
      expect(isCloudflareAddress(outside), outside).toBe(false);
    }
    for (const inside of ['2606:4700::1', '2606:4700:4700::1111', '2606:4700:ffff:ffff::1', '2400:cb00::1', '2803:f800:1::1', '2405:b500::9', '2405:8100::9', '2a06:98c0::1', '2a06:98c7:ffff::1', '2c0f:f248::1']) {
      expect(isCloudflareAddress(inside), inside).toBe(true);
    }
    for (const outside of ['2606:4701::1', '2606:46ff::1', '2001:db8::1', '2a06:98c8::1', '2a06:98bf::1', '2c0f:f249::1', '::1', '::']) {
      expect(isCloudflareAddress(outside), outside).toBe(false);
    }
  });

  it('what is not an address is not Cloudflare\'s (a hostname, text, a mapped address, a malformed one)', () => {
    for (const text of ['', 'sakolakembara.org.', '104.16.0.0/13', '104.16.0', '104.16.0.256', '1.2.3.4.5', '::ffff:104.16.0.1', '2606:4700:::1', '2606:4700::1::2', 'gggg::1', '2606:4700:1:2:3:4:5:6:7']) {
      expect(isCloudflareAddress(text), JSON.stringify(text)).toBe(false);
    }
  });

  it('an A or AAAA record whose CONTENT is a Cloudflare address fails, proxied or not, and names the record and the address', () => {
    for (const line of [
      'www.sakolakembara.org.\t1\tIN\tA\t104.21.8.9 ; cf_tags=cf-proxied:true',
      'www.sakolakembara.org.\t1\tIN\tA\t172.67.1.2 ; cf_tags=cf-proxied:false',
      'api.sakolakembara.org.\t1\tIN\tAAAA\t2606:4700:3030::6815:809 ; cf_tags=cf-proxied:true',
    ]) {
      const results = check(withLines(line));
      const failure = results.find((r) => r.id === 'Z-01' && r.level === 'FAIL')!;
      expect(failure, line).toBeDefined();
      expect(failure.text).toMatch(/^(A|AAAA) (www|api) has the Cloudflare address /);
      expect(failure.text).toContain('ORIGIN');
    }
  });

  it('the apex copied from the scan (the incident) fails, even when everything else is right', () => {
    const results = check(HEALTHY.replace('203.0.113.10 ; cf_tags=cf-proxied:true', '104.21.31.222 ; cf_tags=cf-proxied:true'));
    expect(fails(results).map((r) => r.id)).toEqual(['Z-01']);
    expect(fails(results)[0]!.text).toContain('A @ has the Cloudflare address 104.21.31.222');
  });
});

describe('the zone as it should be', () => {
  it('a healthy export has no failure and no warning, says what Microsoft 365 holds, and lists the proxied names', () => {
    const results = check(HEALTHY);
    expect(fails(results)).toEqual([]);
    expect(results.filter((r) => r.level === 'WARN')).toEqual([]);
    expect(results.find((r) => r.id === 'Z-06')!.text).toContain('MX present, SPF includes spf.protection.outlook.com, autodiscover present, DKIM selectors both present');
    expect(results.find((r) => r.id === 'Z-07')!.text).toBe('3 proxied record(s): A @, AAAA @, CNAME www');
    expect(levels(results, 'Z-01')).toEqual(['PASS']);
    expect(levels(results, 'Z-02')).toEqual(['PASS']);
  });

  it('a wildcard fails (the broken wildcard of the live zone); --allow-wildcard turns it into a warning; any type counts', () => {
    for (const line of ['*.sakolakembara.org.\t1\tIN\tA\t203.0.113.10 ; cf_tags=cf-proxied:true', '*.sakolakembara.org.\t1\tIN\tTXT\t"x" ; cf_tags=cf-proxied:false', '*.mail.sakolakembara.org.\t1\tIN\tCNAME\tx.example.test. ; cf_tags=cf-proxied:false']) {
      const results = check(withLines(line));
      expect(levels(results, 'Z-02'), line).toEqual(['FAIL']);
      expect(levels(check(withLines(line), { allowWildcard: true }), 'Z-02'), line).toEqual(['WARN']);
    }
    expect(check(withLines('*.sakolakembara.org.\t1\tIN\tA\t203.0.113.10 ; cf_tags=cf-proxied:true')).find((r) => r.id === 'Z-02')!.text).toContain('and proxied');
  });

  it('a PROXIED mail, autodiscover, DKIM, hosting-panel or Microsoft 365 record fails; the same names DNS-only pass; a proxied name that is none of those is only listed', () => {
    for (const name of ['mail', 'smtp', 'imap', 'pop', 'webmail', 'autodiscover', 'lyncdiscover', 'sip', 'enterpriseregistration', 'enterpriseenrollment', 'msoid', 'cpanel', 'whm', 'webdisk', 'ftp']) {
      const proxied = check(`${HEALTHY.replace(`${name}.sakolakembara.org.`, 'x-none.')}${name}.sakolakembara.org.\t1\tIN\tA\t203.0.113.11 ; cf_tags=cf-proxied:true\n`);
      expect(levels(proxied, 'Z-03'), name).toEqual(['FAIL']);
      const dnsOnly = check(`${HEALTHY}${name}.sakolakembara.org.\t1\tIN\tA\t203.0.113.11 ; cf_tags=cf-proxied:false\n`);
      expect(levels(dnsOnly, 'Z-03'), name).toEqual(['PASS']);
    }
    expect(levels(check(HEALTHY.replace('selector1._domainkey.sakolakembara.org.\t1\tIN\tCNAME\tselector1-sakolakembara-org._domainkey.contoso.onmicrosoft.com. ; cf_tags=cf-proxied:false', 'selector1._domainkey.sakolakembara.org.\t1\tIN\tCNAME\tselector1-sakolakembara-org._domainkey.contoso.onmicrosoft.com. ; cf_tags=cf-proxied:true')), 'Z-03')).toEqual(['FAIL']);
    // a CNAME to Microsoft under any name, and an MX
    expect(levels(check(withLines('outlook.sakolakembara.org.\t1\tIN\tCNAME\tautodiscover.outlook.com. ; cf_tags=cf-proxied:true')), 'Z-03')).toEqual(['FAIL']);
    expect(levels(check(withLines('sakolakembara.org.\t1\tIN\tMX\t10 other.example.test. ; cf_tags=cf-proxied:true')), 'Z-03')).toEqual(['FAIL']);
    // the LMS and the blog are Dzul's to proxy or not: only listed
    const lms = check(HEALTHY.replace('lms.example.test. ; cf_tags=cf-proxied:false', 'lms.example.test. ; cf_tags=cf-proxied:true'));
    expect(fails(lms)).toEqual([]);
    expect(lms.find((r) => r.id === 'Z-07')!.text).toContain('CNAME lms');
  });

  it('a record that points at workers.dev fails', () => {
    const results = check(withLines('next.sakolakembara.org.\t1\tIN\tCNAME\tsakem-web-staging.acme.workers.dev. ; cf_tags=cf-proxied:false'));
    expect(levels(results, 'Z-04')).toEqual(['FAIL']);
    expect(levels(check(HEALTHY), 'Z-04')).toEqual(['PASS']);
  });

  it('the apex must be proxied for a route to attach: an unproxied apex fails, a missing one fails, an unproxied or missing www warns', () => {
    const unproxied = check(HEALTHY.replace('203.0.113.10 ; cf_tags=cf-proxied:true', '203.0.113.10 ; cf_tags=cf-proxied:false').replace('2001:db8::10 ; cf_tags=cf-proxied:true', '2001:db8::10 ; cf_tags=cf-proxied:false'));
    expect(unproxied.filter((r) => r.id === 'Z-05').map((r) => r.level)).toEqual(['FAIL', 'PASS']);
    const noApex = check(HEALTHY.replace(/^sakolakembara\.org\.\t1\tIN\tA\t.*$/m, '').replace(/^sakolakembara\.org\.\t1\tIN\tAAAA\t.*$/m, ''));
    expect(noApex.find((r) => r.id === 'Z-05')!.level).toBe('FAIL');
    expect(noApex.find((r) => r.id === 'Z-05')!.text).toContain('the site is down');
    const www = check(HEALTHY.replace('sakolakembara.org. ; cf_tags=cf-proxied:true', 'sakolakembara.org. ; cf_tags=cf-proxied:false'));
    expect(www.filter((r) => r.id === 'Z-05').map((r) => r.level)).toEqual(['PASS', 'WARN']);
    const noWww = check(HEALTHY.replace(/^www\..*$/m, ''));
    expect(noWww.filter((r) => r.id === 'Z-05').map((r) => r.level)).toEqual(['PASS', 'WARN']);
  });

  it('Microsoft 365 mail: a missing SPF include, autodiscover or DKIM selector warns; no MX warns; another provider is a note', () => {
    expect(levels(check(HEALTHY.replace('include:spf.protection.outlook.com ', '')), 'Z-06')).toEqual(['INFO', 'WARN']);
    expect(levels(check(HEALTHY.replace(/^autodiscover.*$/m, '')), 'Z-06')).toEqual(['INFO', 'WARN']);
    expect(levels(check(HEALTHY.replace(/^selector2.*$/m, '')), 'Z-06')).toEqual(['INFO', 'WARN']);
    expect(levels(check(HEALTHY.replace(/^sakolakembara\.org\.\t1\tIN\tMX.*$/m, '')), 'Z-06')).toEqual(['WARN']);
    expect(levels(check(HEALTHY.replace('sakolakembara-org.mail.protection.outlook.com.', 'mail.example.test.')), 'Z-06')).toEqual(['INFO']);
  });

  it('an export with no cf_tags (the old provider\'s) says so, skips the proxy rules and still checks the rest', () => {
    const plain = HEALTHY.replace(/ ; cf_tags=cf-proxied:(true|false)/g, '').replace('203.0.113.10', '104.21.31.222');
    const results = check(`${plain}*.sakolakembara.org.\t1\tIN\tA\t203.0.113.10\n`);
    expect(levels(results, 'Z-00')).toEqual(['WARN']);
    expect(levels(results, 'Z-03')).toEqual([]);
    expect(levels(results, 'Z-05')).toEqual([]);
    expect(levels(results, 'Z-07')).toEqual([]);
    expect(levels(results, 'Z-01').includes('FAIL')).toBe(true);
    expect(levels(results, 'Z-02')).toEqual(['FAIL']);
  });

  it('the export of another zone, or of nothing, is not accepted', () => {
    expect(check('other.example.test.\t1\tIN\tA\t203.0.113.10 ; cf_tags=cf-proxied:true\n')).toEqual([{ id: 'Z-00', level: 'FAIL', text: expect.stringContaining('right zone') }]);
    expect(check('')[0]!.level).toBe('FAIL');
  });

  it('the report never prints the content of a record that is not Cloudflare\'s own (the origin\'s address, the mail targets)', () => {
    const text = render(check(withLines('www2.sakolakembara.org.\t1\tIN\tA\t198.51.100.77 ; cf_tags=cf-proxied:true', 'mail.sakolakembara.org.\t1\tIN\tA\t198.51.100.78 ; cf_tags=cf-proxied:true')));
    expect(text).toContain('FAIL Z-03 A mail is PROXIED');
    for (const hidden of ['203.0.113.10', '198.51.100.77', '198.51.100.78', 'mail.protection.outlook.com', 'contoso', '2001:db8']) expect(text, hidden).not.toContain(hidden);
    expect(text).toMatch(/-- 1 failed, 0 warnings$/);
  });
});

describe('the program', () => {
  const tmp = () => mkdtempSync(path.join(tmpdir(), 'zone-export-'));
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
  };

  it('reads one file outside the repository and exits 0 on a healthy export, 1 on a failure', () => {
    const dir = tmp();
    writeFileSync(path.join(dir, 'ok.txt'), HEALTHY);
    writeFileSync(path.join(dir, 'bad.txt'), HEALTHY.replace('203.0.113.10 ; cf_tags=cf-proxied:true', '104.21.31.222 ; cf_tags=cf-proxied:true'));
    const ok = io();
    expect(main([path.join(dir, 'ok.txt')], ok.io)).toBe(0);
    expect(ok.out.join('')).toContain('0 failed');
    const bad = io();
    expect(main([path.join(dir, 'bad.txt')], bad.io)).toBe(1);
    expect(bad.out.join('')).toContain('FAIL Z-01');
  });

  it('refuses a file inside the repository (the export is private), a missing file, no file, two files, an unknown option', () => {
    const inside = io();
    expect(main([path.join(repoRoot, 'cf/web/package.json')], inside.io)).toBe(2);
    expect(inside.err.join('')).toContain('outside the repository');
    expect(inside.out).toEqual([]);
    const missing = io();
    expect(main([path.join(tmp(), 'nope.txt')], missing.io)).toBe(2);
    for (const argv of [[], ['a', 'b'], ['--bogus', path.join(tmp(), 'x')]]) {
      const c = io();
      expect(main(argv, c.io), argv.join(' ')).toBe(2);
      expect(c.err.join('')).toContain('usage');
    }
  });

  it('--allow-wildcard is passed on', () => {
    const dir = tmp();
    writeFileSync(path.join(dir, 'w.txt'), withLines('*.sakolakembara.org.\t1\tIN\tA\t203.0.113.10 ; cf_tags=cf-proxied:false'));
    const strict = io();
    expect(main([path.join(dir, 'w.txt')], strict.io)).toBe(1);
    const allowed = io();
    expect(main([path.join(dir, 'w.txt'), '--allow-wildcard'], allowed.io)).toBe(0);
    expect(allowed.out.join('')).toContain('WARN Z-02');
  });

  it('uses no network and writes nothing: it reads one file and prints', () => {
    const source = readFileSync(path.join(repoRoot, 'cf/scripts/check-zone-export.mjs'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect([...source.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]).sort()).toEqual(['node:fs', 'node:path', 'node:url']);
    expect([...source.matchAll(/^import \{([^}]*)\} from 'node:fs'/gm)].map((m) => m[1]!.split(',').map((s) => s.trim()).sort())).toEqual([['existsSync', 'readFileSync']]);
    expect(source).not.toMatch(/\bfetch\(|node:http|node:net|child_process|writeFile|appendFile|process\.env|dns\./);
  });
});
