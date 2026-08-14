# Replacing Program Photos & Documents

> **Scope.** How to swap the placeholder activity photos and sample PDFs on
> `/program/pembinaan` for the real ones.
>
> **Audience.** Anyone with the files — no coding required for the swap
> itself.

Everything on that page is referenced by a **fixed file name**. Overwrite the
file, keep the name, and the page picks it up. No code change needed.

The files currently in the repo are placeholders: each image says
"FOTO PLACEHOLDER" on its face and prints its own path, and both PDFs say the
same in their body text. Nothing there is real documentation.

## 1. Activity photos

| Activity           | File to replace                                |
| ------------------ | ---------------------------------------------- |
| KBM Pekanan        | `public/images/program/kbm-pekanan.jpg`        |
| Asrama Akhir Tahun | `public/images/program/asrama-akhir-tahun.jpg` |
| Asrama Intensif    | `public/images/program/asrama-intensif.jpg`    |
| Mentoring          | `public/images/program/mentoring.jpg`          |

Requirements:

- **JPG format**, file name exactly as above (all lowercase, hyphenated,
  `.jpg` extension).
- **Landscape 3:2**, e.g. 1200×800 px. The card crops to a landscape area, so
  portrait photos lose their top and bottom.
- **Under ~500 KB** each. Compress camera output at <https://squoosh.app>
  first.
- Use photos where students are recognisable in a dignified way and consent
  to publication has been given.

## 2. Sample documents

| Document                     | File to replace                                    |
| ---------------------------- | -------------------------------------------------- |
| Talents Mapping sample result | `public/files/contoh-hasil-talents-mapping.pdf`    |
| Kurikulum Khusus sample       | `public/files/kurikulum-khusus-sakola-kembara.pdf` |

Requirements:

- **PDF format**, file name exactly as above.
- No personal student data (full name, address, phone number). On the Talents
  Mapping sample, redact the name or replace it with "Contoh Siswa".
- Keep it under ~5 MB so it opens quickly on a phone.

## 3. Uploading

Either route works.

**A. Through GitHub — no tooling required**

1. Open the repo on GitHub and navigate into the target folder (e.g.
   `public/images/program`).
2. Click **Add file → Upload files**.
3. Drag in the new file using the same name, then **Commit changes**.
4. GitHub overwrites the placeholder. The next deploy serves the new file.

**B. From a local clone**

```bash
# overwrite the placeholder with the real photo
cp ~/Downloads/foto-kbm.jpg public/images/program/kbm-pekanan.jpg

git add public/images/program/kbm-pekanan.jpg
git commit -m "chore(program): real KBM Pekanan photo"
git push
```

## 4. Verifying

Run `npm run dev`, open <http://localhost:3000/program/pembinaan>, and check
that:

- No image reads "FOTO PLACEHOLDER" any more.
- Each PDF button opens the correct document.

If an old photo still shows after replacing it, that is browser cache —
reload with **Ctrl+Shift+R** (**Cmd+Shift+R** on macOS).

## 5. Adding a new activity, badge, or document

Activity data lives in `lib/data.ts` under `programs[].subPrograms`, typed as
`SubProgram`. Three fields are optional:

```ts
{
  title: "KBM Pekanan",
  description: "...",
  hours: "290+ jam belajar setahun",        // study-hours badge
  image: "/images/program/kbm-pekanan.jpg",  // card thumbnail
  attachment: {                              // PDF download button
    label: "Contoh hasil Talents Mapping",
    href: "/files/contoh-hasil-talents-mapping.pdf",
  },
}
```

Omitted fields simply do not render: an activity without `image` shows no
thumbnail, one without `attachment` shows no download button.

Note that `hours`, `label`, and all other user-facing strings stay in
Indonesian — they are rendered on the public site.
