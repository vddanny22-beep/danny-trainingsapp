// Tells the user when a new version has been downloaded, instead of letting
// the service worker cache hold them on an old build until they happen to
// fully close the app. That matters more now the app is shared: otherwise
// people report bugs that were fixed days ago.

function showUpdateBanner(waitingWorker) {
  if (document.querySelector(".update-banner")) return; // already offered

  const banner = document.createElement("div");
  banner.className = "update-banner";

  const text = document.createElement("span");
  text.textContent = "Nieuwe versie beschikbaar";
  banner.appendChild(text);

  const reloadBtn = document.createElement("button");
  reloadBtn.type = "button";
  reloadBtn.className = "btn btn-small btn-accent";
  reloadBtn.textContent = "Herladen";
  reloadBtn.addEventListener("click", () => {
    reloadBtn.disabled = true;
    // The reload itself is triggered by the controllerchange handler below,
    // once this worker has actually taken over.
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  });
  banner.appendChild(reloadBtn);

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "btn btn-small";
  dismissBtn.textContent = "Later";
  dismissBtn.setAttribute("aria-label", "Melding sluiten");
  dismissBtn.addEventListener("click", () => banner.remove());
  banner.appendChild(dismissBtn);

  document.body.appendChild(banner);
}

export function watchForUpdates(registration) {
  // Already downloaded and waiting from an earlier visit.
  if (registration.waiting && navigator.serviceWorker.controller) {
    showUpdateBanner(registration.waiting);
  }

  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      // "installed" with a controller already present means this is an update.
      // On a first-ever install there is no controller and nothing to announce.
      if (installing.state === "installed" && navigator.serviceWorker.controller) {
        showUpdateBanner(installing);
      }
    });
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return; // controllerchange can fire more than once
    reloading = true;
    window.location.reload();
  });
}
