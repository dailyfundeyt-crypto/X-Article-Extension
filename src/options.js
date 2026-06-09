const DEFAULTS = {
  baseFolder: "X to Obsidian",
  imagesSubfolder: "Bilder",
  embedStyle: "wikilink",
  includeFrontmatter: true,
  addTag: "x",
};

const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  $("baseFolder").value = s.baseFolder;
  $("imagesSubfolder").value = s.imagesSubfolder;
  $("embedStyle").value = s.embedStyle;
  $("includeFrontmatter").checked = !!s.includeFrontmatter;
  $("addTag").value = s.addTag;
  updatePreview();
}

function updatePreview() {
  $("pvBase").textContent = $("baseFolder").value.trim() || DEFAULTS.baseFolder;
  $("pvImg").textContent = $("imagesSubfolder").value.trim() || DEFAULTS.imagesSubfolder;
}

async function save() {
  const data = {
    baseFolder: $("baseFolder").value.trim() || DEFAULTS.baseFolder,
    imagesSubfolder: $("imagesSubfolder").value.trim() || DEFAULTS.imagesSubfolder,
    embedStyle: $("embedStyle").value,
    includeFrontmatter: $("includeFrontmatter").checked,
    addTag: $("addTag").value.trim(),
  };
  await chrome.storage.sync.set(data);
  const saved = $("saved");
  saved.hidden = false;
  setTimeout(() => (saved.hidden = true), 1800);
}

$("save").addEventListener("click", save);
$("baseFolder").addEventListener("input", updatePreview);
$("imagesSubfolder").addEventListener("input", updatePreview);

load();
