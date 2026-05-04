const form = document.querySelector("#deployForm");
const submitButton = document.querySelector("#submitButton");
const stepsElement = document.querySelector("#steps");
const resultElement = document.querySelector("#result");

let pollTimer = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearTimeout(pollTimer);
  resultElement.textContent = "";
  submitButton.disabled = true;
  setSteps(["Submitting request"], 0);

  const payload = {
    slug: document.querySelector("#slug").value,
    passcode: document.querySelector("#passcode").value,
    prompt: document.querySelector("#prompt").value
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
