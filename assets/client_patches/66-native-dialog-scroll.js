(() => {
  if (document.getElementById("fc-native-dialog-scroll")) return;
  const style = document.createElement("style");
  style.id = "fc-native-dialog-scroll";
  style.textContent = "html:has(dialog:modal) { overflow: hidden; }";
  document.head.append(style);
})();
