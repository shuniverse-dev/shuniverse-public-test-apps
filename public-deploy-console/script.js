const form = document.querySelector("#deployForm");
const submitButton = document.querySelector("#submitButton");
const stepsElement = document.querySelector("#steps");
const resultElement = document.querySelector("#result");
const promptElement = document.querySelector("#prompt");
const modeInputs = document.querySelectorAll("input[name='deployMode']");

let pollTimer = null;
const standardPrompt = "Create a simple desktop browser game controlled with keyboard arrow keys. The game features a cute rabbit racing in a Formula 1 car, dodging rivals, collecting speed boosts, and chasing the fastest lap.";
const mobilePrompt = "Create a simple mobile-optimized game with large touch controls and a phone-friendly layout. The game features a cute rabbit racing in a Formula 1 car.";

initializeMode();

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
      pollTimer = window.setTimeout(() => pollStatus(requestId, publicUrl), 5000);
      return;
    }

    if (data.conclusion === "success") {
      setSteps(["Request accepted", "GitHub Actions completed", "App deployed", "Public link ready"], 4);
      renderSuccessResult(publicUrl);
      submitButton.disabled = false;
      return;
    }

    setSteps(["Request accepted", "GitHub Actions completed", `Deployment failed: ${data.conclusion || "unknown"}`], 2, true);
    if (data.run_url) {
      resultElement.innerHTML = `<a href="${data.run_url}" target="_blank" rel="noopener">Open failed run</a>`;
    }
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
