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
    lastProjectPath: null,
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

  const ARM_ROLES = ["reference", "candidate"];
  const DEFAULT_AGENT = "claude";

  function fillSelect(select, entries, selected) {
    const options = entries.map((entry) =>
      typeof entry === "string" ? { value: entry, label: entry } : entry
    );
    select.innerHTML = "";
    for (const option of options) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.appendChild(element);
    }
    const values = options.map((option) => option.value);
    if (selected && values.includes(selected)) {
      select.value = selected;
    }
  }

  function modelsFor(agent) {
    return (state.catalog && state.catalog.modelsByAgent && state.catalog.modelsByAgent[agent]) || [];
  }

  function refreshEffortOptions(role) {
    const models = modelsFor(el(`evaluation-${role}-agent`).value);
    const chosen = models.find((model) => model.id === el(`evaluation-${role}-model`).value);
    const efforts = chosen && chosen.efforts.length > 0 ? chosen.efforts : ["low", "medium", "high"];
    const preferred = efforts.includes("high") ? "high" : efforts[efforts.length - 1];
    fillSelect(el(`evaluation-${role}-effort`), efforts, preferred);
  }

  function refreshModelOptions(role) {
    const models = modelsFor(el(`evaluation-${role}-agent`).value);
    fillSelect(
      el(`evaluation-${role}-model`),
      models.map((model) => ({ value: model.id, label: `${model.name} (${model.id})` }))
    );
    refreshEffortOptions(role);
  }

  // Templates rather than free text: the shape is exact, and the only thing
  // left to fill in is which file the subject actually is.
  const GUIDANCE_TEMPLATES = {
    skill: {
      kind: "skill",
      name: "writing-clean-code",
      sourcePath: "<absolute path to the skill directory>",
    },
    "referenced-document": {
      kind: "referenced-document",
      name: "coding-quality",
      sourcePath: "subjects/coding-quality-v1.md",
      pointerFile: "subjects/pointer-coding-quality.md",
      workspacePath: "coding-quality.md",
    },
    "instruction-file": {
      kind: "instruction-file",
      name: "repository-instructions",
      sourcePath: "subjects/repository-instructions.md",
    },
  };

  // Reading a real project beats retyping its guidance: the instruction file
  // comes first because it is always in context, then the documents it points
  // at, then the skills that only load when the agent judges them relevant.
  async function discoverInto(role) {
    const picked = await guard(
      () => window.skillManager.pickFolder(state.lastProjectPath || null),
      "Choosing a project folder"
    );
    if (!picked || picked.cancelled || !picked.selectedPath) {
      return;
    }
    state.lastProjectPath = picked.selectedPath;
    const found = await guard(
      () =>
        api.discoverProject({
          projectPath: picked.selectedPath,
          agent: el(`evaluation-${role}-agent`).value,
        }),
      "Discovering guidance"
    );
    if (!found) {
      return;
    }
    el(`evaluation-${role}-guidance`).value = JSON.stringify(found.guidance, null, 2);
    const counts = found.guidance.reduce((totals, subject) => {
      totals[subject.kind] = (totals[subject.kind] || 0) + 1;
      return totals;
    }, {});
    log(
      `${role}: found ${found.guidance.length} subject(s) in ${picked.selectedPath} ` +
        `(${Object.entries(counts).map(([kind, n]) => `${n} ${kind}`).join(", ") || "none"}). ` +
        "Delete the ones you do not want."
    );
    for (const note of found.notes) {
      log(`${role}: ${note}`);
    }
  }

  function appendGuidance(role, kind) {
    const field = el(`evaluation-${role}-guidance`);
    let current = [];
    try {
      current = JSON.parse(field.value.trim() || "[]");
    } catch {
      log(`The ${role} guidance set is not valid JSON, so nothing was added.`);
      return;
    }
    if (!Array.isArray(current)) {
      log(`The ${role} guidance set must be a JSON array.`);
      return;
    }
    current.push(GUIDANCE_TEMPLATES[kind]);
    field.value = JSON.stringify(current, null, 2);
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
    for (const role of ARM_ROLES) {
      fillSelect(el(`evaluation-${role}-agent`), state.catalog.agents, DEFAULT_AGENT);
      refreshModelOptions(role);
    }
    const availability = await api.availability();
    const summary = Object.entries(availability)
      .map(([agent, status]) =>
        status.available ? `${agent}: ${status.version}` : `${agent}: unavailable`
      )
      .join("  |  ");
    setMeta("evaluation-availability", summary);
    for (const [agent, status] of Object.entries(availability)) {
      log(
        status.available
          ? `${agent} ready: ${status.version} at ${status.cliPath}`
          : `${agent} is unavailable (${status.cliPath}): ${status.reason}`
      );
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

  for (const role of ARM_ROLES) {
    el(`evaluation-${role}-agent`).addEventListener("change", () => refreshModelOptions(role));
    el(`evaluation-${role}-model`).addEventListener("change", () => refreshEffortOptions(role));
    el(`evaluation-${role}-add-skill`).addEventListener("click", () => appendGuidance(role, "skill"));
    el(`evaluation-${role}-add-document`).addEventListener("click", () =>
      appendGuidance(role, "referenced-document")
    );
    el(`evaluation-${role}-add-instructions`).addEventListener("click", () =>
      appendGuidance(role, "instruction-file")
    );
    el(`evaluation-${role}-clear-guidance`).addEventListener("click", () => {
      el(`evaluation-${role}-guidance`).value = "[]";
    });
    el(`evaluation-${role}-discover`).addEventListener("click", () => discoverInto(role));
  }

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
