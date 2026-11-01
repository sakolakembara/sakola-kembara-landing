// The SPA's negative checks of the Media library, the picker and the making-smaller of pictures (SAKEM-117), in their own file
// so the shared list in negative-checks-spa.mjs stays short: it imports and spreads `mediaSpaChecks`. Same rules as there: each
// check breaks ONE safeguard in the source, runs the tests that must notice, expects them to FAIL, and the runner restores the
// file. `from` and `to` may be lists, for a safeguard built in more than one place.
//
//   node scripts/negative-checks-spa.mjs --only "media:"
//
// The Worker's side (the library's list, the detail, the text alternative, and what the SPA relies on) is in
// negative-checks-uploads.mjs; the tests it runs are test/media-library.test.ts.

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

const RESIZE = "crud/image-resize.test.ts";
const UPLOAD = "crud/upload.test.tsx";
const PAGE = "media-page.test.tsx";
const PICKER = "media-picker.test.tsx";
const MODEL = "media-model.test.ts";
const MOCK = "media-mock.test.ts";
const EDITOR = "blog-editor.test.tsx";

const RESIZE_FILE = "spa/src/lib/crud/image-resize.ts";
const CLIENT = "spa/src/lib/crud/upload-client.ts";
const MEDIA = "spa/src/lib/crud/media.ts";
const FIELD = "spa/src/components/crud/UploadField.tsx";
const PICKER_FILE = "spa/src/components/media/MediaPicker.tsx";
const MODAL = "spa/src/components/crud/Modal.tsx";
const DETAIL = "spa/src/components/media/MediaDetail.tsx";
const PAGE_FILE = "spa/src/pages/media/MediaPage.tsx";
const QUEUE = "spa/src/lib/crud/useUploadQueue.ts";
const MOCK_FILE = "spa/src/mock/handlers/media.ts";

export const mediaSpaChecks = [
  // ---------------------------------------------- a picture is made smaller before it is sent
  {
    name: "media: a GIF is made again (it would lose its motion)",
    file: RESIZE_FILE,
    from: 'const RESIZABLE_TYPES = ["image/png", "image/jpeg", "image/webp"];',
    to: 'const RESIZABLE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];',
    tests: t(RESIZE),
  },
  {
    name: "media: a small picture is made larger",
    file: RESIZE_FILE,
    from: "const scale = Math.min(1, max / Math.max(width, height));",
    to: "const scale = max / Math.max(width, height);",
    tests: t(RESIZE),
  },
  {
    name: "media: a WebP that already fits is written again (a loss of quality for nothing)",
    file: RESIZE_FILE,
    from: "if (alreadyWebp && !shrinks) return file;",
    to: "",
    tests: t(RESIZE),
  },
  {
    name: "media: a WebP larger than the file it came from is sent",
    file: RESIZE_FILE,
    from: "if (!shrinks && blob.size >= file.size) return file;",
    to: "",
    tests: t(RESIZE),
  },
  {
    name: "media: what a browser that cannot write WebP gave (a PNG, or nothing) is sent as the WebP",
    file: RESIZE_FILE,
    from: 'if (!blob || blob.type !== "image/webp" || blob.size === 0) return file;',
    to: "if (!blob) return file;",
    tests: t(RESIZE),
  },
  {
    name: "media: a file the browser cannot read fails the upload instead of being sent as it is",
    file: RESIZE_FILE,
    from: "  } catch {\n    return file;\n  }\n  try {",
    to: "  } catch (error) {\n    throw error;\n  }\n  try {",
    tests: t(RESIZE),
  },
  {
    name: "media: the decoded picture is not let go",
    file: RESIZE_FILE,
    from: "bitmap.close();",
    to: "",
    tests: t(RESIZE),
  },
  {
    name: "media: a file too large to decode safely is decoded",
    file: RESIZE_FILE,
    from: " || file.size > MAX_DECODE_BYTES",
    to: "",
    tests: t(RESIZE),
  },
  {
    name: "media: the size limit is checked on the file as the camera wrote it, before it is made smaller",
    file: CLIENT,
    from: "checkUploadFile(file, kind, { ignoreSize: true })",
    to: "checkUploadFile(file, kind)",
    tests: t(RESIZE, UPLOAD),
  },
  {
    name: "media: the size limit is not checked on the file that will be sent",
    file: CLIENT,
    from: "const tooBig = checkUploadFile(prepared, kind);",
    to: "const tooBig = null as string | null;",
    tests: t(RESIZE, UPLOAD),
  },
  {
    name: "media: a screen's upload skips the making-smaller",
    file: CLIENT,
    from: "const prepared = await prepareUpload(request.file, request.kind);",
    to: "const prepared = { ok: true as const, file: request.file };",
    tests: t(UPLOAD, EDITOR),
  },
  {
    name: "media: the upload field sends the file as it is",
    file: FIELD,
    from: [
      'import { discardUpload, submitUpload, useUploadsBase, type UploadResult } from "~/lib/crud/upload-client";',
      "const outcome = await submitUpload({ kind, file,",
    ],
    to: [
      'import { discardUpload, uploadFile as submitUpload, useUploadsBase, type UploadResult } from "~/lib/crud/upload-client";',
      "const outcome = await submitUpload({ kind, file,",
    ],
    tests: t(UPLOAD),
  },
  {
    name: "media: a picture pasted into the editor is sent as it is",
    file: "spa/src/pages/blog/editor/images.ts",
    from: ['import { submitUpload } from "~/lib/crud/upload-client";', 'await submitUpload({ kind: "blog-image", file })'],
    to: ['import { uploadFile } from "~/lib/crud/upload-client";', 'await uploadFile({ kind: "blog-image", file })'],
    tests: t(EDITOR),
  },

  // ---------------------------------------------- the picker
  {
    name: "media: a file chosen from the library that is the field's file already is discarded as an abandoned upload",
    file: FIELD,
    from: "if (previous !== item.path) release(previous);",
    to: "release(previous);",
    tests: t(PICKER),
  },
  {
    name: "media: a file chosen from the library comes without its size (Laporan and Pusat Dokumen save it)",
    file: FIELD,
    from: "onChange(item.path, item);",
    to: "onChange(item.path);",
    tests: t(PICKER),
  },
  {
    name: "media: the picker lists the files of every kind, not the field's",
    file: PICKER_FILE,
    from: "useMediaList({ ...query, kind, pageSize: PAGE_SIZE })",
    to: "useMediaList({ ...query, kind: null, pageSize: PAGE_SIZE })",
    tests: t(PICKER, EDITOR),
  },
  {
    name: "media: a picture chosen in the library goes to the end of the text instead of the cursor",
    file: "spa/src/pages/blog/editor/RichEditor.tsx",
    from: "    editor.chain().focus().insertContent(picture).run();\n  }, []);",
    to: '    editor.chain().focus("end").insertContent(picture).run();\n  }, []);',
    tests: t(EDITOR),
  },
  {
    name: "media: a text alternative written in the picker is not saved to the file",
    file: PICKER_FILE,
    from: 'if (!isImage(selected) || alt.trim() === (selected.altText ?? "")) {',
    to: "if (true) {",
    tests: t(PICKER, EDITOR),
  },
  {
    name: "media: the file is used although the Worker refused its text alternative",
    file: PICKER_FILE,
    from: "      return;\n    }\n    onPick(result.data.item);",
    to: "    }\n    onPick(selected);",
    tests: t(PICKER, EDITOR),
  },
  {
    name: "media: the picker can be closed while the text alternative is being saved",
    file: PICKER_FILE,
    from: "locked={saving} ",
    to: "",
    tests: t(PICKER),
  },
  {
    name: "media: the window is drawn inside the form that opened it (Enter in its search would belong to that form)",
    file: MODAL,
    from: "return createPortal(",
    to: "return ((node: ReactNode, _target: Element) => node)(",
    tests: t(PICKER),
  },
  {
    name: "media: closing the window does not give the focus back to the button that opened it",
    file: MODAL,
    from: "      if (target?.isConnected) target.focus();\n      else focusMain();",
    to: "      focusMain();",
    tests: t(PICKER),
  },
  {
    name: "media: the window's content is built while it is closed (the editor would ask for the library at once)",
    file: MODAL,
    from: "{open && (",
    to: "{(",
    tests: t(EDITOR),
  },
  {
    name: "media: Enter in the picker's search is left to whatever form holds it",
    file: "spa/src/components/media/MediaFilters.tsx",
    from: "            event.preventDefault();\n            search.flush();",
    to: "            search.flush();",
    tests: t(PICKER),
  },

  // ---------------------------------------------- the Media page
  {
    name: "media: a reader is offered the upload, the ticks and the delete",
    file: PAGE_FILE,
    from: 'const canWrite = accessTo(me, "konten") === "write";',
    to: "const canWrite = true;",
    tests: t(PAGE),
  },
  {
    name: "media: a reader can edit the text alternative in the panel",
    file: DETAIL,
    from: "disabled={!canWrite}",
    to: "disabled={false}",
    tests: t(PAGE),
  },
  {
    name: "media: a reader is offered 'Simpan teks alt' in the panel",
    file: DETAIL,
    from: '          {canWrite && (\n            <div className="flex items-center gap-3">',
    to: '          {(\n            <div className="flex items-center gap-3">',
    tests: t(PAGE),
  },
  {
    name: "media: a reader is offered Hapus in the panel",
    file: DETAIL,
    from: '      {canWrite && (\n        <div>\n          <Button variant="neutral" fullWidth',
    to: '      {(\n        <div>\n          <Button variant="neutral" fullWidth',
    tests: t(PAGE),
  },
  {
    name: "media: where a file is used is not asked for, and the panel says it is used nowhere",
    file: MEDIA,
    from: 'setState(result.ok ? { status: "ready", usedBy: result.data.usedBy, failure: null } : { status: "error", usedBy: null, failure: result });',
    to: 'setState({ status: "ready", usedBy: [], failure: null });',
    tests: t(PAGE),
  },
  {
    name: "media: a failed check of where a file is used reads as 'used nowhere'",
    file: DETAIL,
    from: 'if (failed) return <p className="text-sm text-gray-600">Tidak bisa memeriksa pemakaian file ini.</p>;',
    to: "",
    tests: t(PAGE),
  },
  {
    name: "media: the list is not asked for again after an upload",
    file: PAGE_FILE,
    from: "setActive(mediaItemFromUpload(result, kindForFile(file), me.name));\n                list.refetch();",
    to: "setActive(mediaItemFromUpload(result, kindForFile(file), me.name));",
    tests: t(PAGE),
  },
  {
    name: "media: the ticks outlive the page they were made on",
    file: PAGE_FILE,
    from: "useSelection(list.items, idOf, searchFor(query.page))",
    to: 'useSelection(list.items, idOf, "")',
    tests: t(PAGE),
  },
  {
    name: "media: a search or a filter keeps the page it was on",
    file: PAGE_FILE,
    from: "onChange={(patch) => go({ ...query, ...patch, page: 1 })}",
    to: "onChange={(patch) => go({ ...query, ...patch })}",
    tests: t(PAGE),
  },
  {
    name: "media: a PDF dropped on the page is stored as a picture",
    file: MEDIA,
    from: 'return isPdfFile(file) ? "report" : "blog-image";',
    to: 'return "blog-image";',
    tests: t(MODEL, PAGE),
  },
  {
    name: "media: a type the address bar makes up is trusted",
    file: "spa/src/pages/media/model.ts",
    from: 'type: type === "image" || type === "pdf" ? (type as MediaTypeFilter) : EMPTY_QUERY.type,',
    to: 'type: (type ?? "") as MediaTypeFilter,',
    tests: t(MODEL),
  },
  {
    name: "media: a window of days is asked for as a moment, not as the start of a day",
    file: MEDIA,
    from: "return at.toISOString().slice(0, 10);",
    to: "return at.toISOString();",
    tests: t(MODEL),
  },
  {
    name: "media: 'Batal' leaves the file on its way going",
    file: QUEUE,
    from: "    waiting.current = [];\n    abort.current?.abort();\n    setJobs(",
    to: "    waiting.current = [];\n    setJobs(",
    tests: t(PAGE),
  },
  {
    name: "media: leaving the page leaves the files waiting to be sent",
    file: QUEUE,
    from: "        abort.current = null;\n        if (!mounted.current) return;",
    to: "        abort.current = null;",
    tests: t(PAGE),
  },

  // ---------------------------------------------- the mock answers by the Worker's rules
  {
    name: "media (mock): a file in use is deleted",
    file: MOCK_FILE,
    from: "if (users.length > 0) return error(409,",
    to: "if (false) return error(409,",
    tests: t(MOCK),
  },
  {
    name: "media (mock): a text alternative of any length is saved",
    file: MOCK_FILE,
    from: "if (text.length > 300)",
    to: "if (text.length > 300000)",
    tests: t(MOCK),
  },
  {
    name: "media (mock): a picker of a kind the person may not read lists it",
    file: MOCK_FILE,
    from: 'if (!readable(accessOf(AREA_OF_KIND[kind as UploadKindName]))) return error(403, "forbidden");',
    to: "",
    tests: t(MOCK),
  },
];
