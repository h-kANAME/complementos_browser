chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => {
    console.error("Muestrario: no se pudo preparar el panel.", error);
  });
