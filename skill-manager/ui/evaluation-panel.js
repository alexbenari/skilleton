(function () {
  const api = window.skillManager && window.skillManager.evaluation;
  if (!api) {
    return;
  }

  const state = {
    catalog: null,
    plan: null,
    comparisonId: null,
    bundlePath: null,
    unblinded: false,
  };

  const el = (id) => document.getElementById(id);
  const panel = el("evaluation-panel");
  const logEl = el("evaluation-log");

  function log(text) {
    logEl.textContent += `${text}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setMeta(id, text) {
    el(id).textContent = text;
  }

  function fillSelect(select, values, selected) {
    select.innerHTML = "";
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
    if (selected && values.includes(selected)) {
      select.value = selected;
    }
  }

  function scenariosForTarget(targetId) {
    return state.catalog.scenarios
      .filter((scenario) => scenario.targetId === targetId)
      .map((scenario) => scenario.id);
  }

  function refreshScenarioOptions() {
    const targetId = el("evaluation-target").value;
    fillSelect(el("evaluation-scenario"), scenariosForTarget(targetId));
  }

  function parseGuidance(id) {
    const raw = el(id).value.trim();
    if (raw === "") {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error("expected a JSON array");
      }
      return parsed;
    } catch (error) {
      throw new Error(`${id.includes("reference") ? "Reference" : "Candidate"} guidance set is not a JSON array: ${error.message}`);
    }
  }

  function buildRequest() {
    const factor = el("evaluation-factor").value;
    return {
      id: el("evaluation-id").value.trim(),
      targetId: el("evaluation-target").value,
      scenarioId: el("evaluation-scenario").value,
      guidanceDifferenceMode: factor === "guidance" ? el("evaluation-mode").value : null,
      reviewerRole: el("evaluation-reviewer").value,
      decisionFraming: el("evaluation-framing").value,
      repetitionCount: Number(el("evaluation-repetitions").value) || 1,
      rubric: state.plan ? state.plan.rubric : undefined,
      referenceArm: {
        agent: el("evaluation-reference-agent").value,
        model: el("evaluation-reference-model").value.trim(),
        effort: el("evaluation-reference-effort").value.trim(),
        guidance: parseGuidance("evaluation-reference-guidance"),
      },
      candidateArm: {
        agent: el("evaluation-candidate-agent").value,
        model: el("evaluation-candidate-model").value.trim(),
        effort: el("evaluation-candidate-effort").value.trim(),
        guidance: parseGuidance("evaluation-candidate-guidance"),
      },
    };
  }

  async function guard(action, label) {
    try {
      return await action();
    } catch (error) {
      log(`${label} failed: ${error.message}`);
      return null;
    }
  }

  async function loadCatalog() {
    state.catalog = await api.listCatalog();
    fillSelect(
      el("evaluation-target"),
      state.catalog.targets.map((target) => target.id)
    );
    refreshScenarioOptions();
    for (const id of ["evaluation-reference-agent", "evaluation-candidate-agent"]) {
      fillSelect(el(id), state.catalog.agents, "codex");
    }
    const availability = await api.availability();
    const summary = Object.entries(availability)
      .map(([agent, status]) =>
        status.available ? `${agent}: ${status.version}` : `${agent}: unavailable`
      )
      .join("  |  ");
    setMeta("evaluation-availability", summary);
    for (const [agent, status] of Object.entries(availability)) {
      if (!status.available) {
        log(`${agent} is unavailable: ${status.reason}`);
      }
    }
  }

  function renderDimensions(rubric) {
    const container = el("evaluation-dimensions");
    container.innerHTML = "";
    for (const name of rubric) {
      const wrap = document.createElement("div");
      const label = document.createElement("label");
      label.textContent = name;
      const input = document.createElement("textarea");
      input.rows = 2;
      input.dataset.dimension = name;
      input.placeholder = `How do A and B compare on ${name}?`;
      wrap.appendChild(label);
      wrap.appendChild(input);
      container.appendChild(wrap);
    }
  }

  function collectDimensions() {
    return [...el("evaluation-dimensions").querySelectorAll("textarea")]
      .filter((input) => input.value.trim() !== "")
      .map((input) => ({ name: input.dataset.dimension, assessment: input.value.trim() }));
  }

  // Evaluation is a mode of its own, not a section of the skills browser. The
  // skills list is long once a library is loaded, and appending a panel below
  // it put the panel off screen, so opening it looked like nothing happened.
  function showEvaluation(shouldShow) {
    panel.hidden = !shouldShow;
    el("skills-section").hidden = shouldShow;
    el("evaluation-toggle").textContent = shouldShow ? "Back to Skills" : "Evaluate";
    const sidePanel = el("side-panel");
    if (shouldShow && sidePanel) {
      sidePanel.setAttribute("aria-hidden", "true");
      sidePanel.classList.remove("open");
    }
    window.scrollTo(0, 0);
  }

  el("evaluation-toggle").addEventListener("click", async () => {
    showEvaluation(panel.hidden);
    if (panel.hidden) {
      return;
    }
    if (!state.catalog) {
      await guard(loadCatalog, "Loading the evaluation catalog");
    }
  });

  el("evaluation-target").addEventListener("change", refreshScenarioOptions);

  el("evaluation-factor").addEventListener("change", () => {
    el("evaluation-mode-wrap").hidden = el("evaluation-factor").value !== "guidance";
  });

  el("evaluation-propose").addEventListener("click", async () => {
    const plan = await guard(
      () =>
        api.proposePlan({
          targetId: el("evaluation-target").value,
          scenarioId: el("evaluation-scenario").value,
        }),
      "Proposing a plan"
    );
    if (!plan) {
      return;
    }
    state.plan = plan;
    setMeta(
      "evaluation-plan",
      `Rubric: ${plan.rubric.join(", ")} | checks: ${plan.checks.map((check) => check.id).join(", ") || "none"} | run manifest ${plan.requiresRunManifest ? "required" : "not required"}`
    );
    renderDimensions(plan.rubric);
    log(`Plan proposed for ${plan.scenarioId}.`);
  });

  el("evaluation-save").addEventListener("click", async () => {
    const saved = await guard(() => api.saveDefinition(buildRequest()), "Saving the definition");
    if (saved) {
      log(`Saved ${saved.id} v${saved.version}; varied factor ${saved.variedFactor}.`);
    }
  });

  el("evaluation-start").addEventListener("click", async () => {
    const definitionId = el("evaluation-id").value.trim();
    if (!definitionId) {
      log("Set a definition id first.");
      return;
    }
    log(`Starting ${definitionId}...`);
    const result = await guard(() => api.start(definitionId), "Starting the evaluation");
    if (!result) {
      return;
    }
    state.comparisonId = result.comparisonId;
    state.bundlePath = result.bundlePath;
    log(`Both arms finished. Varied factor ${result.variedFactor}.`);
    for (const note of result.drift || []) {
      log(`Drift: ${note}`);
    }
    el("evaluation-review").hidden = false;
    setMeta(
      "evaluation-review-intro",
      "Two outputs, labelled A and B. Which is which is sealed until you unblind or submit."
    );
  });

  el("evaluation-cancel").addEventListener("click", async () => {
    const stopped = await guard(
      () => api.cancel(el("evaluation-id").value.trim()),
      "Cancelling"
    );
    log(stopped ? "Cancellation requested." : "Nothing to cancel.");
  });

  for (const [buttonId, label] of [
    ["evaluation-open-a", "A"],
    ["evaluation-open-b", "B"],
  ]) {
    el(buttonId).addEventListener("click", async () => {
      if (!state.bundlePath) {
        log("Run an evaluation first.");
        return;
      }
      await guard(() => api.openPath(`${state.bundlePath}\\${label}`), `Opening output ${label}`);
    });
  }

  el("evaluation-unblind").addEventListener("click", () => {
    state.unblinded = true;
    log("Unblinded. The report will record that this verdict was not blind.");
  });

  el("evaluation-submit-review").addEventListener("click", async () => {
    if (!state.comparisonId) {
      log("Run an evaluation first.");
      return;
    }
    const dimensions = collectDimensions();
    if (dimensions.length === 0) {
      log("Assess at least one dimension before submitting.");
      return;
    }
    const result = await guard(
      () =>
        api.submitUserReview(state.comparisonId, {
          dimensions,
          recommendation: el("evaluation-recommendation").value,
          reasoning: el("evaluation-reasoning").value.trim(),
          uncertainty: el("evaluation-uncertainty").value.trim(),
          unblinded: state.unblinded,
        }),
      "Submitting the verdict"
    );
    if (result) {
      log(`Report written to ${result.reportPath}`);
    }
  });

  el("evaluation-open-report").addEventListener("click", async () => {
    if (!state.comparisonId) {
      log("Run an evaluation first.");
      return;
    }
    await guard(() => api.openReport(state.comparisonId), "Opening the report");
  });

  api.onProgress((event) => {
    if (event.phase === "run-event") {
      return;
    }
    if (event.phase === "run-finished") {
      const checks = (event.checks || []).map((check) => `${check.id}=${check.status}`).join(", ");
      log(`${event.role} run ${event.runIndex}: ${event.status}${checks ? ` (${checks})` : ""}`);
      return;
    }
    if (event.phase === "run-started") {
      log(`${event.role} run ${event.runIndex} started on ${event.agent}.`);
      return;
    }
    log(`${event.phase}${event.role ? ` (${event.role})` : ""}`);
  });
})();
