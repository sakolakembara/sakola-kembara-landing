// The receipt of a one-off donation (SAKEM-128), from /donasi/bayar: the chosen file goes to PUT /donasi/bukti as it
// is (a PDF, or a photo that is already small), or as a smaller JPEG first (a phone photo of 4,000 px is mostly bytes
// nobody needs to read a transfer). Then the thank-you page. Every failure says what to do in the form's own words.

const MAX_SIDE = 2000;
const JPEG_QUALITY = 0.85;
/** Below this a photo is sent as it is. */
const SMALL_ENOUGH = 1_500_000;

/** A photo made smaller in the browser, or the file itself when that is not worth it or not possible. */
async function shrink(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size <= SMALL_ENOUGH || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export function sendProof(): void {
  const form = document.getElementById('donasi-bukti') as HTMLFormElement | null;
  const input = form?.querySelector<HTMLInputElement>('input[type=file]');
  const name = form?.querySelector<HTMLElement>('[data-file-name]');
  const error = form?.querySelector<HTMLElement>('[data-proof-error]');
  const button = form?.querySelector<HTMLButtonElement>('[type=submit]');
  const label = button?.querySelector<HTMLElement>('[data-label]');
  if (!form || !input || !name || !error || !button || !label) return;
  const max = Number(form.dataset.max) || 10_000_000;
  const idle = label.textContent;
  const empty = name.textContent;

  const fail = (message: string) => {
    error.textContent = message;
    error.hidden = false;
    button.disabled = false;
    label.textContent = idle;
  };

  input.addEventListener('change', () => {
    error.hidden = true;
    name.textContent = input.files?.[0]?.name ?? empty;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    const file = input.files?.[0];
    if (!file) return fail('Pilih foto atau PDF bukti transfer dulu.');
    button.disabled = true;
    label.textContent = 'Mengunggah...';
    const body = await shrink(file);
    if (body.size > max) return fail('Berkas lebih dari 10 MB. Pilih foto atau PDF yang lebih kecil.');
    try {
      const response = await fetch('/donasi/bukti', { method: 'PUT', body, headers: { 'content-type': 'application/octet-stream' }, credentials: 'same-origin' });
      if (response.ok) {
        location.assign('/donasi/terima-kasih');
        return;
      }
      const answer = (await response.json().catch(() => null)) as { message?: string } | null;
      if (response.status === 404) {
        location.assign('/donasi');
        return;
      }
      fail(answer?.message ?? 'Bukti transfer belum dapat diunggah saat ini. Silakan coba lagi.');
    } catch {
      fail('Koneksi terputus. Silakan coba lagi.');
    }
  });
}
