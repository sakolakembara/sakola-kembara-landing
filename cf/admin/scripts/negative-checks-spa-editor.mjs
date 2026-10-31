// The SPA's negative checks of the editor frame (SAKEM-116: the shell's top bar as the editor's one bar, the tabs, the blog
// form's three tabs, Card and Switch), in their own file like negative-checks-spa-listtools.mjs: negative-checks-spa.mjs
// imports and spreads `editorSpaChecks`. Same rules: each check breaks ONE safeguard (the patch must stay valid code), runs
// the tests that must notice, expects them to FAIL, and the runner restores the file.
//
//   node scripts/negative-checks-spa.mjs --only "editor: "

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

const FRAME = "editor-frame.test.tsx";
const BLOG = "blog.test.tsx";
const EDITOR_TESTS = "blog-editor.test.tsx";
const ROUND_TRIP = "blog-editor-roundtrip.test.ts";
const FALLBACK = "blog-editor-fallback.test.tsx";

const BREADCRUMB = "spa/src/components/Breadcrumb.tsx";
const SHELL = "spa/src/components/Shell.tsx";
const PAGE_BAR = "spa/src/components/crud/PageBar.tsx";
const PAGE_TABS = "spa/src/components/crud/PageTabs.tsx";
const BLOG_FORM = "spa/src/pages/blog/BlogFormPage.tsx";
const SWITCH = "spa/src/components/ui/switch.tsx";
const BODY = "spa/src/pages/blog/BodyEditor.tsx";
const RICH = "spa/src/pages/blog/editor/RichEditor.tsx";
const EXTENSIONS = "spa/src/pages/blog/editor/extensions.ts";
const SERIALIZE = "spa/src/pages/blog/editor/serialize.ts";
const SLASH = "spa/src/pages/blog/editor/SlashCommand.ts";
const SLASH_MENU = "spa/src/pages/blog/editor/SlashMenu.tsx";
const SLASH_ITEMS = "spa/src/pages/blog/editor/slashItems.ts";
const BUBBLE = "spa/src/pages/blog/editor/BubbleToolbar.tsx";
const LINKS = "spa/src/pages/blog/editor/links.ts";
const COMBOBOX_FILE = "spa/src/components/ui/combobox.tsx";
const AUTHOR_FILE = "spa/src/pages/blog/AuthorField.tsx";
const COMBOBOX = "combobox.test.tsx";
const AUTHOR = "blog-author.test.tsx";
const MOCK_BLOG = "spa/src/mock/resources/blog.ts";

export const editorSpaChecks = [
  // ---------------------------------------------- the one bar
  {
    name: "editor: the breadcrumb forgets the title of the page it is on",
    file: BREADCRUMB,
    from: "const crumbs = leaf ? [...found, { label: leaf }] : found;",
    to: "const crumbs = found;",
    tests: t(FRAME, BLOG),
  },
  {
    name: "editor: the link to the site stays and crowds the page's buttons",
    file: SHELL,
    from: "{!chrome?.hasActions && (",
    to: "{true && (",
    tests: t(FRAME),
  },
  {
    name: "editor: a desktop draws the page's buttons in the page, a second bar under the shell's",
    file: PAGE_BAR,
    from: "const slots = desktop && chrome?.actions ? { leading: chrome.leading, actions: chrome.actions } : null;",
    to: "const slots = desktop && chrome?.actions && false ? { leading: chrome.leading, actions: chrome.actions } : null;",
    tests: t(FRAME),
  },
  {
    name: "editor: a phone puts the page's buttons in the desktop's bar, which it does not show",
    file: PAGE_BAR,
    from: "const slots = desktop && chrome?.actions ? {",
    to: "const slots = chrome?.actions ? {",
    tests: t(FRAME),
  },
  {
    name: "editor: leaving the page leaves its crumb and its buttons' room behind",
    file: PAGE_BAR,
    from: "      setLeaf?.(null);\n      setHasActions?.(false);",
    to: "      void 0;",
    tests: t(FRAME),
  },
  {
    name: "editor: the save button is not tied to the form, so it saves nothing and the browser's checks are skipped",
    file: BLOG_FORM,
    from: '<Button variant="neutral" type="submit" form={formId} disabled={save.pending}>',
    to: '<Button variant="neutral" type="button" disabled={save.pending}>',
    tests: t(FRAME, BLOG),
  },
  {
    name: "editor: a published article is offered 'Terbitkan' beside 'Simpan' as a draft is",
    file: BLOG_FORM,
    from: "{canWrite && item && !published && (",
    to: "{canWrite && item && (",
    tests: t(BLOG),
  },
  {
    name: "editor: a role that cannot write is given tabs it has nothing to do with",
    file: BLOG_FORM,
    from: "const tabbed = canWrite;",
    to: "const tabbed = true;",
    tests: t(BLOG),
  },
  {
    name: "editor: a refused save does not open the tab that holds the first error",
    file: BLOG_FORM,
    from: '    setTab(wanted);\n    if (first === "contentMarkdown") setBodyMode("edit");\n  }, [save.failures]);',
    to: '    if (first === "contentMarkdown") setBodyMode("edit");\n  }, [save.failures]);',
    tests: t(BLOG),
  },
  {
    name: "editor: a link of the error summary does not show the tab its field is on",
    file: BLOG_FORM,
    from: "      flushSync(() => {\n        setTab(wanted);",
    to: "      flushSync(() => {\n        void wanted;",
    tests: t(BLOG),
  },

  // ---------------------------------------------- the tabs
  {
    name: "editor: the arrow keys change the tab but the focus stays behind",
    file: PAGE_TABS,
    from: "    document.getElementById(`tab-${tabs[next].id}`)?.focus();",
    to: "    void 0;",
    tests: t(FRAME),
  },
  {
    name: "editor: every tab is in the tab order, so Tab walks through all of them",
    file: PAGE_TABS,
    from: "tabIndex={selected ? 0 : -1}",
    to: "tabIndex={0}",
    tests: t(FRAME),
  },
  {
    name: "editor: Home goes nowhere",
    file: PAGE_TABS,
    from: 'else if (event.key === "Home") next = 0;',
    to: 'else if (event.key === "Home") next = index;',
    tests: t(FRAME),
  },
  {
    name: "editor: the arrows stop at the ends instead of wrapping",
    file: PAGE_TABS,
    from: 'if (event.key === "ArrowRight") next = (index + 1) % tabs.length;',
    to: 'if (event.key === "ArrowRight") next = Math.min(index + 1, tabs.length - 1);',
    tests: t(FRAME),
  },
  {
    name: "editor: a tab does not name the panel it controls",
    file: PAGE_TABS,
    from: "aria-controls={`panel-${tab.id}`}",
    to: "aria-controls={`tab-${tab.id}`}",
    tests: t(FRAME),
  },

  // ---------------------------------------------- the kit's Switch
  {
    name: "editor: a switch's description is not read with the control",
    file: SWITCH,
    from: "aria-describedby={errorId ?? descriptionId}",
    to: "aria-describedby={undefined}",
    tests: t(FRAME),
  },
  {
    name: "editor: a refused switch is not marked invalid",
    file: SWITCH,
    from: "aria-invalid={error ? true : undefined}",
    to: "aria-invalid={undefined}",
    tests: t(FRAME),
  },

  // ---------------------------------------------- the text editor (TipTap)
  {
    name: "editor: the text is saved with the gaps the editor keeps (an empty line becomes &nbsp;)",
    file: SERIALIZE,
    from: '.filter((node: JSONContent) => !(node.type === "paragraph" && (node.content ?? []).length === 0))',
    to: ".filter(() => true)",
    tests: t(EDITOR_TESTS, ROUND_TRIP),
  },
  {
    name: "editor: what the editor reports is not the Markdown (the form never learns of a change)",
    file: RICH,
    from: "onUpdate: ({ editor: current }) => onChangeRef.current(articleMarkdown(current)),",
    to: "onUpdate: () => undefined,",
    tests: t(BLOG, EDITOR_TESTS),
  },
  {
    name: "editor: a role that cannot write can change the text",
    file: RICH,
    from: "editable: !readOnly,",
    to: "editable: true,",
    tests: t(BLOG),
  },
  {
    name: "editor: the screen reader is not told the text is wrong when it is refused",
    file: RICH,
    from: 'flag("aria-invalid", invalid);',
    to: "void invalid;",
    tests: t(BLOG),
  },
  {
    name: "editor: a picture pasted from the clipboard is left to the browser",
    file: RICH,
    from: 'if (files.length === 0 || data?.getData("text/plain") || data?.getData("text/html")) return false;',
    to: "if (files.length >= 0) return false;",
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: a dropped picture goes where the cursor is, not where it was dropped",
    file: RICH,
    from: "else editor.chain().focus().insertContentAt(position, picture).run();",
    to: "else editor.chain().focus().insertContent(picture).run();",
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: a file that is not a picture, dropped on the page, is left to the browser (which opens it and leaves the page and the unsaved text)",
    file: RICH,
    from: "const files = moved ? [] : Array.from(event.dataTransfer?.files ?? []);",
    to: "const files = moved ? [] : picturesIn(event.dataTransfer?.files);",
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: a clipboard with words and a picture is taken for a picture, and the words are lost",
    file: RICH,
    from: 'if (files.length === 0 || data?.getData("text/plain") || data?.getData("text/html")) return false;',
    to: "if (files.length === 0) return false;",
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: a picture drawn before the files domain was known stays pointed at this host",
    file: RICH,
    from: '      for (const image of editor.view.dom.querySelectorAll<HTMLImageElement>(\'img[src^="/uploads/"]\')) image.setAttribute("src", uploadUrl(image.getAttribute("src") ?? "", base));',
    to: "      void base;",
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: pictures are drawn from the page's own host, not the files domain",
    file: RICH,
    from: "displaySrc: (src) => uploadUrl(src, baseRef.current),",
    to: "displaySrc: (src) => src,",
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: a picture copied out of the page keeps the address it was drawn from (the text loses its path)",
    file: RICH,
    from: "return origin !== \"\" && src.startsWith(`${origin}/uploads/`) ? src.slice(origin.length) : src;",
    to: "return src;",
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: the preview shows the text the editor started from, not the text now",
    file: BODY,
    from: "  if (previewing) seed.current = value;",
    to: "  if (previewing) seed.current = seed.current;",
    tests: t(BLOG),
  },
  {
    name: "editor: if the editor cannot be loaded nothing takes its place",
    file: BODY,
    from: "<EditorBoundary fallback={<PlainBody",
    to: "<EditorBoundary fallback={null} data-was={<PlainBody",
    tests: t(FALLBACK),
  },
  {
    name: "editor: Enter in the title saves the form",
    file: "spa/src/pages/blog/BlogFormPage.tsx",
    from: "          event.preventDefault();\n          document.getElementById(\"contentMarkdown\")?.focus();",
    to: "          document.getElementById(\"contentMarkdown\")?.focus();",
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: the editor accepts the underline Markdown cannot say",
    file: EXTENSIONS,
    from: "      underline: false,",
    to: "      underline: {},",
    tests: t(EDITOR_TESTS, ROUND_TRIP),
  },
  {
    name: "editor: only the first heading levels are read (a # or ##### heading becomes text)",
    file: EXTENSIONS,
    from: "heading: { levels: [1, 2, 3, 4, 5, 6] },",
    to: "heading: { levels: [2, 3] },",
    tests: t(ROUND_TRIP),
  },
  {
    name: "editor: a table is not in the editor, so a table of an article is flattened",
    file: EXTENSIONS,
    from: "    TableKit.configure({ table: { resizable: false } }),",
    to: "",
    tests: t(ROUND_TRIP, EDITOR_TESTS),
  },

  // ---------------------------------------------- the "/" menu
  {
    name: "editor: the '/' menu opens in code, where a '/' is a '/'",
    file: SLASH,
    from: 'allow: ({ editor }) => !editor.isActive("codeBlock") && !editor.isActive("code"),',
    to: "allow: () => true,",
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: an address is a command (the '/' after 'https:' opens the menu)",
    file: SLASH,
    from: 'allowedPrefixes: [" "],',
    to: "allowedPrefixes: null,",
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: Enter does not insert the item the arrows chose",
    file: SLASH_MENU,
    from: 'else if (event.key === "Enter") command(items[active] ?? items[0]!);',
    to: 'else if (event.key === "Enter") void 0;',
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: the arrow keys do not move down the list",
    file: SLASH_MENU,
    from: 'if (event.key === "ArrowDown") setActive((now) => (now + 1) % items.length);',
    to: 'if (event.key === "ArrowDown") setActive((now) => now);',
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: the screen reader is not told which item is chosen",
    file: SLASH_MENU,
    from: '    if (current) dom.setAttribute("aria-activedescendant", optionId(current));\n    else dom.removeAttribute("aria-activedescendant");',
    to: '    dom.removeAttribute("aria-activedescendant");',
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: the editor still says a list is open after it closed",
    file: SLASH_MENU,
    from: '      dom.setAttribute("aria-expanded", "false");',
    to: "      void 0;",
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: the words a writer would try ('foto', 'daftar') find nothing, only the title does",
    file: SLASH_ITEMS,
    from: "const words = (item: SlashItem) => [item.title.toLowerCase(), ...item.keywords];",
    to: "const words = (item: SlashItem) => [item.title.toLowerCase()];",
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: a query nothing matches still shows the whole list",
    file: SLASH_ITEMS,
    from: "  return [...starts, ...contains];",
    to: "  return [...starts, ...contains].length > 0 ? [...starts, ...contains] : SLASH_ITEMS;",
    tests: t(EDITOR_TESTS),
  },

  // ---------------------------------------------- the toolbar over a selection and the links
  {
    name: "editor: the toolbar for words shows over a picture too",
    file: BUBBLE,
    from: 'shouldShow={({ editor: current, from, to }) => from !== to && !current.isActive("image") && !current.isActive("codeBlock")}',
    to: 'shouldShow={({ editor: current, from, to }) => from !== to && !current.isActive("codeBlock")}',
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: the alt text box loses the picture after one letter (the node is replaced and the selection falls to the text)",
    file: BUBBLE,
    from: "      tr.setSelection(NodeSelection.create(tr.doc, selection.from));\n",
    to: "",
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: Enter in the alt text box saves the article",
    file: BUBBLE,
    from: '            if (event.key === "Enter" || event.key === "Escape") {\n              event.preventDefault();',
    to: '            if (event.key === "Enter" || event.key === "Escape") {\n              void 0;',
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: Enter in the link box saves the article",
    file: BUBBLE,
    from: '    } else if (event.key === "Enter") {\n      event.preventDefault();\n      applyLink();',
    to: '    } else if (event.key === "Enter") {\n      applyLink();',
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: Ctrl+K over some words does nothing",
    file: RICH,
    from: 'event.key.toLowerCase() === "k"',
    to: 'event.key.toLowerCase() === "kk"',
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: a link to anything but http, https, mailto, tel or a page of ours is kept (javascript:)",
    file: LINKS,
    from: '    return url.protocol === "http:" || url.protocol === "https:" ? withScheme : null;',
    to: "    return withScheme;",
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: an address with two slashes at the start is read as a page of ours",
    file: LINKS,
    from: '  if (text.startsWith("//")) return null; // another site\'s address without its scheme: not ours to guess',
    to: "",
    tests: t(EDITOR_TESTS),
  },
  {
    name: "editor: a site without a scheme is kept as typed, so it becomes a path of ours",
    file: LINKS,
    from: '`https://${text}`',
    to: "text",
    tests: t(EDITOR_TESTS),
  },

  // ---------------------------------------------- the author box (Penulis)
  {
    name: "editor: author: what is typed in the box that is no option is kept when the box is left",
    file: COMBOBOX_FILE,
    from: "          if (same) choose(same);\n          else close();",
    to: "          if (same) choose(same);\n          else if (query !== null) {\n            onChange(query);\n            close();\n          } else close();",
    tests: t(COMBOBOX),
  },
  {
    name: "editor: author: Enter in the box reaches the form and saves it",
    file: COMBOBOX_FILE,
    from: '    } else if (event.key === "Enter") {\n      event.preventDefault();\n      if (current) choose(current);',
    to: '    } else if (event.key === "Enter") {\n      if (current) choose(current);',
    tests: t(COMBOBOX),
  },
  {
    name: "editor: author: the arrow keys do not move through the list",
    file: COMBOBOX_FILE,
    from: "setActive((now) => (now + (event.key === \"ArrowDown\" ? 1 : -1) + visible.length) % visible.length)",
    to: "setActive((now) => now)",
    tests: t(COMBOBOX),
  },
  {
    name: "editor: author: the box says the list is open when it is closed",
    file: COMBOBOX_FILE,
    from: "aria-expanded={open}",
    to: "aria-expanded={true}",
    tests: t(COMBOBOX),
  },
  {
    name: "editor: author: the option under the arrows is not announced",
    file: COMBOBOX_FILE,
    from: "aria-activedescendant={current ? optionId(current) : undefined}",
    to: "aria-activedescendant={undefined}",
    tests: t(COMBOBOX),
  },
  {
    name: "editor: author: typing does not narrow the list",
    file: COMBOBOX_FILE,
    from: "options.filter((option) => option.label.toLowerCase().includes(wanted))",
    to: "options",
    tests: t(COMBOBOX),
  },
  {
    name: "editor: author: Escape leaves the typed text in the box",
    file: COMBOBOX_FILE,
    from: '    } else if (event.key === "Escape" && open) {\n      event.preventDefault();\n      event.stopPropagation();\n      close();',
    to: '    } else if (event.key === "Escape" && open) {\n      event.preventDefault();\n      event.stopPropagation();\n      setOpen(false);',
    tests: t(COMBOBOX),
  },
  {
    name: "editor: author: the old author of an article is not offered, so it cannot be put back",
    file: AUTHOR_FILE,
    from: '    if (stored !== "" && !names.includes(stored)) list.unshift({ value: stored, label: stored, hint: "nama lama" });',
    to: "    void stored;",
    tests: t(AUTHOR),
  },
  {
    name: "editor: author: a list that cannot be loaded blocks the field",
    file: AUTHOR_FILE,
    from: "{failed ? <Input",
    to: "{false ? <Input",
    tests: t(AUTHOR),
  },
  {
    name: "editor: author: someone who cannot write asks for the list (only a writer may)",
    file: AUTHOR_FILE,
    from: "  if (readOnly) {",
    to: "  if (false) {",
    tests: t(AUTHOR),
  },
  {
    name: "editor: author: a new article starts under the email, not the person's name",
    file: "spa/src/pages/blog/BlogFormPage.tsx",
    from: "author={displayName(me)}",
    to: "author={me.email}",
    tests: t(BLOG, AUTHOR),
  },
  {
    name: "editor: author: the mock saves under any name, so the screen is never seen refused",
    file: MOCK_BLOG,
    from: '    if (!MOCK_AUTHORS.includes(parsed.values.author!)) return mockError(400, "invalid", "Periksa kembali isian formulir.", { fields: { author: AUTHOR_NOT_REGISTERED } });\n',
    to: "",
    tests: t("blog-mock.test.ts"),
  },

  // ---------------------------------------------- Informasi Dasar on Publikasi
  {
    name: "editor: the Excerpt is `required` for the browser again (on a tab nobody sees it refuses the save without a word)",
    file: BLOG_FORM,
    from: '<Textarea aria-required="true" rows={4}',
    to: "<Textarea required rows={4}",
    tests: t(BLOG),
  },
  {
    name: "editor: an error on the Slug does not bring the person to Publikasi",
    file: "spa/src/pages/blog/form.ts",
    from: '  slug: "publikasi",',
    to: '  slug: "konten",',
    tests: t(BLOG),
  },
  {
    name: "editor: an error on the Excerpt does not bring the person to Publikasi",
    file: "spa/src/pages/blog/form.ts",
    from: '  excerpt: "publikasi",',
    to: '  excerpt: "konten",',
    tests: t(BLOG),
  },

  // ---------------------------------------------- the one-page forms (SAKEM-119, pattern 1)
  {
    name: "editor: one-page forms: a reader is offered 'Batal' (nothing can be cancelled), not 'Tutup'",
    file: "spa/src/components/crud/FormShell.tsx",
    from: '<Button variant="ghost" href={back.href}>\n        {readOnly ? "Tutup" : "Batal"}',
    to: '<Button variant="ghost" href={back.href}>\n        {"Batal"}',
    tests: t("shortlinks.test.tsx"),
  },
  {
    name: "editor: one-page forms: the save button in the top bar is not tied to the form, so it saves nothing",
    file: "spa/src/components/crud/FormShell.tsx",
    from: '<Button type="submit" form={formId} disabled={save.pending}>',
    to: '<Button type="submit" disabled={save.pending}>',
    tests: t("shortlinks.test.tsx", "announcements.test.tsx", "reports.test.tsx", "pendaftaran/batches.test.tsx"),
  },
  {
    name: "editor: one-page forms: the side column is not a column, its cards fall in with the main ones",
    file: "spa/src/components/crud/FormShell.tsx",
    from: '<div className="min-w-0 space-y-6">{children}</div>\n      {aside && <div className="min-w-0 space-y-6">{aside}</div>}',
    to: '<div className="min-w-0 space-y-6">{children}{aside}</div>',
    tests: t("shortlinks.test.tsx", "announcements.test.tsx", "reports.test.tsx", "pendaftaran/batches.test.tsx", "editor-frame.test.tsx"),
  },
  {
    name: "editor: one-page forms: a form with no side column still reserves one",
    file: "spa/src/components/crud/FormShell.tsx",
    from: 'aside && "lg:grid-cols-[minmax(0,1fr)_340px]"',
    to: '"lg:grid-cols-[minmax(0,1fr)_340px]"',
    tests: t("editor-frame.test.tsx"),
  },
  {
    name: "editor: one-page forms: the form is capped in width again and leaves a wide window empty at the right",
    file: "spa/src/components/crud/FormShell.tsx",
    from: 'cn("grid items-start gap-6"',
    to: 'cn("grid max-w-5xl items-start gap-6"',
    tests: t("editor-frame.test.tsx"),
  },
  {
    name: "editor: one-page forms: a card without a description still draws an empty one",
    file: "spa/src/components/crud/FormShell.tsx",
    from: "{description && <CardDescription>{description}</CardDescription>}",
    to: "<CardDescription>{description}</CardDescription>",
    tests: t("editor-frame.test.tsx"),
  },
  {
    name: "editor: one-page forms: a saved shortlink always says it is on",
    file: "spa/src/pages/shortlinks/ShortlinkFormPage.tsx",
    from: 'value={item.active ? "active" : "inactive"}',
    to: 'value={"active"}',
    tests: t("shortlinks.test.tsx"),
  },
  {
    name: "editor: one-page forms: the breadcrumb of a saved shortlink says 'Shortlink baru' instead of its slug",
    file: "spa/src/pages/shortlinks/ShortlinkFormPage.tsx",
    from: 'crumb: item ? item.slug : "Shortlink baru"',
    to: 'crumb: "Shortlink baru"',
    tests: t("shortlinks.test.tsx"),
  },
  {
    name: "editor: one-page forms: 'Batal' of a batch's edit page goes to the list, not to the batch",
    file: "spa/src/pages/batches/BatchFormPage.tsx",
    from: "back={{ href: item ? `${ROUTE}/${encodeURIComponent(item.id)}` : ROUTE }}",
    to: "back={{ href: ROUTE }}",
    tests: t("pendaftaran/batches.test.tsx"),
  },
  {
    name: "editor: one-page forms: the breadcrumb of a saved batch says 'Batch baru' instead of its name",
    file: "spa/src/pages/batches/BatchFormPage.tsx",
    from: 'crumb: item ? item.name : "Batch baru"',
    to: 'crumb: "Batch baru"',
    tests: t("pendaftaran/batches.test.tsx"),
  },

  // ---------------------------------------------- Pusat Dokumen and the admin form on the frame, and the polish (SAKEM-119)
  {
    name: "editor: one-page forms: the breadcrumb of a saved document says 'Berkas baru' instead of its title",
    file: "spa/src/pages/resources/ResourceFormPage.tsx",
    from: 'crumb: item ? item.title : "Berkas baru"',
    to: 'crumb: "Berkas baru"',
    tests: t("pendaftaran/resources.test.tsx"),
  },
  {
    name: "editor: one-page forms: the document's type field is outside the Tipe Konten card",
    file: "spa/src/pages/resources/ResourceFormPage.tsx",
    from: '{contentType === "file" && (\n            <UploadField',
    to: '</FormCard>\n        <FormCard title="Tipe file">\n          {contentType === "file" && (\n            <UploadField',
    tests: t("pendaftaran/resources.test.tsx"),
  },
  {
    name: "editor: one-page forms: the admin form has no card of areas in the side column",
    file: "spa/src/pages/settings/AdminFormPage.tsx",
    from: "<FormColumns aside={areaCard}>",
    to: "<FormColumns>",
    tests: t("settings.test.tsx"),
  },
  {
    name: "editor: one-page forms: a saved admin does not show its status next to the breadcrumb",
    file: "spa/src/pages/settings/AdminFormPage.tsx",
    from: "status: item ? <StatusTag map={STATUS} value={item.status} /> : undefined",
    to: "status: undefined",
    tests: t("settings.test.tsx"),
  },
  {
    name: "editor: one-page forms: the breadcrumb of a saved admin says 'Admin baru' instead of its name",
    file: "spa/src/pages/settings/AdminFormPage.tsx",
    from: 'crumb: item ? item.name?.trim() || item.email : "Admin baru"',
    to: 'crumb: "Admin baru"',
    tests: t("settings.test.tsx"),
  },
  {
    name: "editor: polish: a hidden label of a group is drawn after all, repeating the title of its card",
    file: "spa/src/components/ui/field.tsx",
    from: 'hideLabel ? "sr-only" : "mb-1.5")}>\n          {label}\n          {asterisk}\n        </legend>',
    to: '"mb-1.5")}>\n          {label}\n          {asterisk}\n        </legend>',
    tests: t("ui-kit.test.tsx"),
  },
  {
    name: "editor: polish: a hidden label of a single field is drawn after all",
    file: "spa/src/components/ui/field.tsx",
    from: 'hideLabel ? "sr-only" : !labelAside && "mb-1.5")}>',
    to: '!labelAside && "mb-1.5")}>',
    tests: t("ui-kit.test.tsx"),
  },
  {
    name: "editor: polish: the slug box goes back to the heavy 2 px border",
    file: "spa/src/pages/shortlinks/ShortlinkFormPage.tsx",
    from: "overflow-hidden rounded-lg border bg-card transition-colors",
    to: "overflow-hidden rounded-xl border-2 bg-card transition-colors",
    tests: t("shortlinks.test.tsx"),
  },
];
