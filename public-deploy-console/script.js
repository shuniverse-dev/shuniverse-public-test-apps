const form = document.querySelector("#deployForm");
const submitButton = document.querySelector("#submitButton");
const stepsElement = document.querySelector("#steps");
const resultElement = document.querySelector("#result");
const promptElement = document.querySelector("#prompt");
const modeInputs = document.querySelectorAll("input[name='deployMode']");
const historyList = document.querySelector("#historyList");
const refreshHistoryButton = document.querySelector("#refreshHistory");

let pollTimer = null;
const standardPrompt = "Create a simple desktop browser game controlled with keyboard arrow keys. The game features a cute rabbit racing in a Formula 1 car, dodging rivals, collecting speed boosts, and chasing the fastest lap.";
const mobilePrompt = "Create a simple mobile-optimized game with large touch controls and a phone-friendly layout. The game features a cute rabbit racing in a Formula 1 car.";

initializeMode();
loadHistory();

refreshHistoryButton.addEventListener("click", loadHistory);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearTimeout(pollTimer);
  resultElement.textContent = "";
  submitButton.disabled = true;
  setSteps(["Submitting request"], 0);

  const payload = {
    passcode: document.querySelector("#passcode").value,
    prompt: deployPrompt(promptElement.value, selectedMode()),
    deploy_mode: selectedMode()
  };

  try {
    const response = await fetch("api/submit.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Submit failed.");
    }

    setSteps(["Request accepted", "Waiting for GitHub Actions", "Generating app", "Deploying to Plesk"], 1);
    loadHistory();
    pollStatus(data.request_id, data.public_url);
  } catch (error) {
    submitButton.disabled = false;
    setSteps(["Request failed: " + error.message], 0, true);
  }
});

modeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (promptElement.dataset.edited === "true") {
      return;
    }

    promptElement.value = selectedMode() === "mobile" ? mobilePrompt : standardPrompt;
  });
});

promptElement.addEventListener("input", () => {
  promptElement.dataset.edited = "true";
});

async function pollStatus(requestId, publicUrl) {
  try {
    const response = await fetch(`api/status.php?request_id=${encodeURIComponent(requestId)}`);
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Status check failed.");
    }

    if (data.status === "queued" || data.status === "in_progress" || data.status === "waiting") {
      setSteps(["Request accepted", "GitHub Actions started", "Working", "Waiting for final result"], 2);
      loadHistory();
      pollTimer = window.setTimeout(() => pollStatus(requestId, publicUrl), 5000);
      return;
    }

    if (data.conclusion === "success") {
      setSteps(["Request accepted", "GitHub Actions completed", "App deployed", "Public link ready"], 4);
      renderSuccessResult(publicUrl);
      loadHistory();
      submitButton.disabled = false;
      return;
    }

    setSteps(["Request accepted", "GitHub Actions completed", `Deployment failed: ${data.conclusion || "unknown"}`], 2, true);
    if (data.run_url) {
      resultElement.innerHTML = `<a href="${data.run_url}" target="_blank" rel="noopener">Open failed run</a>`;
    }
    loadHistory();
    submitButton.disabled = false;
  } catch (error) {
    setSteps(["Status check failed: " + error.message], 0, true);
    submitButton.disabled = false;
  }
}

function setSteps(items, currentIndex, isError = false) {
  stepsElement.innerHTML = "";

  items.forEach((item, index) => {
    const li = document.createElement("li");
    li.textContent = item;

    if (isError && index === items.length - 1) {
      li.className = "is-error";
    } else if (index < currentIndex) {
      li.className = "is-done";
    } else if (index === currentIndex) {
      li.className = "is-current";
    }

    stepsElement.appendChild(li);
  });
}

function initializeMode() {
  const mobileLikely = window.matchMedia("(max-width: 720px), (pointer: coarse)").matches;
  const defaultMode = mobileLikely ? "mobile" : "standard";
  const defaultInput = document.querySelector(`input[name='deployMode'][value='${defaultMode}']`);

  if (defaultInput) {
    defaultInput.checked = true;
  }

  promptElement.value = defaultMode === "mobile" ? mobilePrompt : standardPrompt;
}

function selectedMode() {
  const checked = document.querySelector("input[name='deployMode']:checked");
  return checked ? checked.value : "standard";
}

function deployPrompt(prompt, mode) {
  const cleanedPrompt = prompt.trim();
  const command = mode === "mobile" ? "PUBLIC MOBILE DEPLOY:" : "PUBLIC DEPLOY:";

  if (/^PUBLIC\s+(MOBILE\s+)?DEPLOY:/i.test(cleanedPrompt)) {
    return cleanedPrompt;
  }

  return `${command}\n${cleanedPrompt}`;
}

async function loadHistory() {
  try {
    const response = await fetch("api/history.php", { cache: "no-store" });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || "History unavailable.");
    }

    renderHistory(data.items || []);
  } catch (error) {
    historyList.innerHTML = `<p class="muted">History could not load.</p>`;
  }
}

function renderHistory(items) {
  historyList.textContent = "";

  if (items.length === 0) {
    historyList.innerHTML = `<p class="muted">No creations yet. Your next deployed app will appear here.</p>`;
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "history-item";

    const meta = document.createElement("div");
    meta.className = "history-meta";

    const title = document.createElement("h2");
    title.textContent = item.label || item.slug;

    const details = document.createElement("p");
    details.textContent = `${modeLabel(item.mode)} · ${statusLabel(item.status)} · ${dateLabel(item.created_at)}`;

    const url = document.createElement("p");
    url.className = "history-url";
    url.textContent = item.url;

    meta.append(title, details, url);

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const open = document.createElement("a");
    open.href = item.url;
    open.target = "_blank";
    open.rel = "noopener";
    open.textContent = "Open";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      const copied = await copyText(item.url);
      copy.textContent = copied ? "Copied" : "Failed";
      window.setTimeout(() => {
        copy.textContent = "Copy";
      }, 1600);
    });

    actions.append(open, copy);

    if (navigator.share && item.status === "success") {
      const share = document.createElement("button");
      share.type = "button";
      share.textContent = "Share";
      share.addEventListener("click", async () => {
        try {
          await navigator.share({
            title: item.label || "SHUNIVERSE public app",
            text: "Open this SHUNIVERSE public app.",
            url: item.url
          });
        } catch (error) {
          if (error.name !== "AbortError") {
            await copyText(item.url);
          }
        }
      });
      actions.appendChild(share);
    }

    card.append(meta, actions);
    historyList.appendChild(card);
  }
}

function modeLabel(mode) {
  return mode === "mobile" ? "Mobile" : "Desktop";
}

function statusLabel(status) {
  if (status === "success") {
    return "Live";
  }
  if (status === "failure") {
    return "Failed";
  }
  if (status === "in_progress" || status === "queued" || status === "waiting") {
    return "Building";
  }
  return "Pending";
}

function dateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderSuccessResult(publicUrl) {
  resultElement.textContent = "";

  const card = document.createElement("div");
  card.className = "result-card";

  const label = document.createElement("p");
  label.className = "result-label";
  label.textContent = "Published app";

  const linkText = document.createElement("p");
  linkText.className = "result-url";
  linkText.textContent = publicUrl;

  const actions = document.createElement("div");
  actions.className = "result-actions";

  const openLink = document.createElement("a");
  openLink.href = publicUrl;
  openLink.target = "_blank";
  openLink.rel = "noopener";
  openLink.textContent = "Open app";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "secondary-action";
  copyButton.textContent = "Copy link";
  copyButton.addEventListener("click", async () => {
    const copied = await copyText(publicUrl);
    copyButton.textContent = copied ? "Copied" : "Copy failed";
    window.setTimeout(() => {
      copyButton.textContent = "Copy link";
    }, 1800);
  });

  actions.append(openLink, copyButton);

  if (navigator.share) {
    const shareButton = document.createElement("button");
    shareButton.type = "button";
    shareButton.className = "secondary-action";
    shareButton.textContent = "Share";
    shareButton.addEventListener("click", async () => {
      try {
        await navigator.share({
          title: "SHUNIVERSE public app",
          text: "Open this deployed browser app.",
          url: publicUrl
        });
      } catch (error) {
        if (error.name !== "AbortError") {
          await copyText(publicUrl);
        }
      }
    });
    actions.appendChild(shareButton);
  }

  card.append(label, linkText, actions);
  resultElement.appendChild(card);
}

async function copyText(value) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch (error) {
    return false;
  }
}
