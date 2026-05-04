const form = document.querySelector("#deployForm");
const submitButton = document.querySelector("#submitButton");
const stepsElement = document.querySelector("#steps");
const resultElement = document.querySelector("#result");
const promptElement = document.querySelector("#prompt");
const modeInputs = document.querySelectorAll("input[name='deployMode']");

let pollTimer = null;
const standardPrompt = "Create a simple keyboard jumping game where the main character is a duck.";
const mobilePrompt = "Create a simple tapping game optimized for mobile phones. Include large touch controls and a layout that fits a phone screen.";

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
      resultElement.innerHTML = `<a href="${publicUrl}" target="_blank" rel="noopener">Open deployed app</a>`;
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
