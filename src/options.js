const DEFAULTS = {
  baseFolder: "X to Obsidian",
  imagesSubfolder: "Bilder",
  embedStyle: "wikilink",
  includeFrontmatter: true,
  addTag: "x",
  aiEnabled: false,
  aiProvider: "openai",
  aiModel: "",
};

const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  const local = await chrome.storage.local.get({ aiApiKey: "" });
  $("baseFolder").value = s.baseFolder;
  $("imagesSubfolder").value = s.imagesSubfolder;
  $("embedStyle").value = s.embedStyle;
  $("includeFrontmatter").checked = !!s.includeFrontmatter;
  $("addTag").value = s.addTag;
  $("aiEnabled").checked = !!s.aiEnabled;
  $("aiProvider").value = s.aiProvider;
  $("aiModel").value = s.aiModel;
  $("aiApiKey").value = local.aiApiKey;
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
    aiEnabled: $("aiEnabled").checked,
    aiProvider: $("aiProvider").value,
    aiModel: $("aiModel").value.trim(),
  };
  await chrome.storage.sync.set(data);
  // API-Schlüssel bewusst nur lokal speichern
  await chrome.storage.local.set({ aiApiKey: $("aiApiKey").value.trim() });
  const saved = $("saved");
  saved.hidden = false;
  setTimeout(() => (saved.hidden = true), 1800);
}

$("save").addEventListener("click", save);
$("baseFolder").addEventListener("input", updatePreview);
$("imagesSubfolder").addEventListener("input", updatePreview);

load();
