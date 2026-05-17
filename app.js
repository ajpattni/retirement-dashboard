const FULL_STATE_PENSION_WEEKLY = 221.2;
const STATE_PENSION_AGE = 67;
const PLSA = [
  { key: "minimum", label: "Minimum", annual: 14400 },
  { key: "moderate", label: "Moderate", annual: 31300 },
  { key: "comfortable", label: "Comfortable", annual: 43100 },
];
const SOURCE_COLOURS = {
  pension: "#ffe17c",
  isa: "#b7c6c2",
  cash: "#ffffff",
  other: "#8f9c98",
  state: "#2d8b64",
};

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `pot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const state = {
  mode: localStorage.getItem("retirementDashboardMode") || "simple",
  incomeView: "monthly",
  realTerms: true,
  dob: "1992-05-10",
  retirementAge: 68,
  salary: 38000,
  employeeContribution: 5,
  employerContribution: 4,
  simpleGrowth: 5,
  existingPot: 8500,
  pensionPots: [
    { id: createId(), label: "Workplace pension", value: 42000, monthly: 420, growth: 5 },
    { id: createId(), label: "Old employer pension", value: 18000, monthly: 0, growth: 4.5 },
  ],
  extraSavings: [],
  isaValue: 12000,
  isaMonthly: 250,
  isaGrowth: 4.5,
  cashValue: 6000,
  cashMonthly: 100,
  cashInterest: 3.5,
  otherValue: 10000,
  otherGrowth: 4,
  statePensionMode: "forecast",
  stateForecastWeekly: 221.2,
  niYears: 28,
  stateManualWeekly: 180,
  drawdownRate: 4,
  inflationRate: 2.5,
};

const $ = (id) => document.getElementById(id);
const money = (value, decimals = 0) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(Number.isFinite(value) ? value : 0);
const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);

function annualToMonthlyRate(annualRate) {
  return Math.pow(1 + annualRate / 100, 1 / 12) - 1;
}

function futureValue(presentValue, monthlyContribution, annualGrowth, months) {
  const r = annualToMonthlyRate(annualGrowth);
  if (months <= 0) return presentValue;
  if (r === 0) return presentValue + monthlyContribution * months;
  return presentValue * Math.pow(1 + r, months) + monthlyContribution * ((Math.pow(1 + r, months) - 1) / r);
}

function deflate(value, years) {
  if (!state.realTerms) return value;
  return value / Math.pow(1 + state.inflationRate / 100, years);
}

function getAgeAndTimeline() {
  const dob = new Date(state.dob);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const hadBirthday = now.getMonth() > dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!hadBirthday) age -= 1;
  const yearsToRetirement = Math.max(0, state.retirementAge - age);
  const retirementDate = new Date(dob);
  retirementDate.setFullYear(dob.getFullYear() + state.retirementAge);
  return { age, yearsToRetirement, months: Math.round(yearsToRetirement * 12), retirementDate };
}

function getStatePensionAnnual() {
  if (state.retirementAge < STATE_PENSION_AGE) return 0;
  let weekly = state.stateForecastWeekly;
  if (state.statePensionMode === "ni") weekly = FULL_STATE_PENSION_WEEKLY * Math.min(35, state.niYears) / 35;
  if (state.statePensionMode === "manual") weekly = state.stateManualWeekly;
  return weekly * 52;
}

function getAssetsAt(months) {
  if (state.mode === "simple") {
    const monthlyContribution = (state.salary * (state.employeeContribution + state.employerContribution)) / 100 / 12;
    const pension = futureValue(state.existingPot, monthlyContribution, state.simpleGrowth, months);
    return { pension, isa: 0, cash: 0, other: 0 };
  }

  const pension = state.pensionPots.reduce((sum, pot) => sum + futureValue(pot.value, pot.monthly, pot.growth, months), 0);
  const isa = futureValue(state.isaValue, state.isaMonthly, state.isaGrowth, months);
  const baseCash = futureValue(state.cashValue, state.cashMonthly, state.cashInterest, months);
  const extraCash = state.extraSavings.reduce((sum, saving) => sum + futureValue(saving.value, saving.monthly, saving.growth, months), 0);
  const cash = baseCash + extraCash;
  const other = futureValue(state.otherValue, 0, state.otherGrowth, months);
  return { pension, isa, cash, other };
}

function calculate() {
  const timeline = getAgeAndTimeline();
  const nominalAssets = getAssetsAt(timeline.months);
  const assets = Object.fromEntries(Object.entries(nominalAssets).map(([key, value]) => [key, deflate(value, timeline.yearsToRetirement)]));
  const totalPot = Object.values(assets).reduce((sum, value) => sum + value, 0);
  const stateAnnual = state.retirementAge >= STATE_PENSION_AGE ? deflate(getStatePensionAnnual(), timeline.yearsToRetirement) : 0;
  const drawdownAnnual = totalPot * (state.drawdownRate / 100);
  const annualIncome = drawdownAnnual + stateAnnual;
  const monthlyIncome = annualIncome / 12;
  return { timeline, assets, totalPot, stateAnnual, drawdownAnnual, annualIncome, monthlyIncome };
}

function benchmarkStatus(annualIncome) {
  if (annualIncome >= PLSA[2].annual) return { key: "comfortable", label: "Comfortable", next: null };
  if (annualIncome >= PLSA[1].annual) return { key: "moderate", label: "Moderate", next: PLSA[2] };
  if (annualIncome >= PLSA[0].annual) return { key: "minimum", label: "Minimum", next: PLSA[1] };
  return { key: "below", label: "Below minimum", next: PLSA[0] };
}

function estimateExtraMonthlyNeeded(targetAnnualIncome, currentAnnualIncome, years) {
  const annualGap = Math.max(0, targetAnnualIncome - currentAnnualIncome);
  const targetPotGap = annualGap / (state.drawdownRate / 100);
  const months = Math.max(1, Math.round(years * 12));
  const growth = state.mode === "simple" ? state.simpleGrowth : 5;
  const r = annualToMonthlyRate(growth);
  const factor = r === 0 ? months : (Math.pow(1 + r, months) - 1) / r;
  const nominalMonthly = targetPotGap / factor;
  return state.realTerms ? nominalMonthly * Math.pow(1 + state.inflationRate / 100, years) : nominalMonthly;
}

function buildProjectionData(timeline) {
  const points = [];
  const years = Math.max(1, timeline.yearsToRetirement);
  for (let i = 0; i <= years; i += 1) {
    const months = i * 12;
    const assets = getAssetsAt(months);
    const adjusted = Object.fromEntries(Object.entries(assets).map(([key, value]) => [key, deflate(value, i)]));
    points.push({ year: new Date().getFullYear() + i, ...adjusted });
  }
  return points;
}

function renderProjectionChart(data) {
  const width = 920;
  const height = 390;
  const pad = { top: 26, right: 28, bottom: 42, left: 72 };
  const keys = state.mode === "simple" ? ["pension"] : ["pension", "isa", "cash", "other"];
  const totals = data.map((point) => keys.reduce((sum, key) => sum + point[key], 0));
  const max = Math.max(...totals, 1000) * 1.12;
  const x = (index) => pad.left + (index / Math.max(1, data.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => height - pad.bottom - (value / max) * (height - pad.top - pad.bottom);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const gy = pad.top + t * (height - pad.top - pad.bottom);
    const value = max * (1 - t);
    return `<line x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}" stroke="rgba(183,198,194,0.18)"/><text x="16" y="${gy + 4}" class="axis-label">${money(value)}</text>`;
  }).join("");

  if (state.mode === "simple") {
    const d = data.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.pension)}`).join(" ");
    const area = `${d} L ${x(data.length - 1)} ${height - pad.bottom} L ${pad.left} ${height - pad.bottom} Z`;
    $("projectionChart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Projected pot growth chart">
      ${grid}
      <path d="${area}" fill="#ffe17c" opacity="0.18"></path>
      <path d="${d}" fill="none" stroke="#ffe17c" stroke-width="5" stroke-linecap="round"></path>
      <line x1="${width - pad.right}" y1="${pad.top}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#ffffff" stroke-dasharray="5 6"/>
      <text x="${pad.left}" y="${height - 12}" class="axis-label">${data[0].year}</text>
      <text x="${width - pad.right - 36}" y="${height - 12}" class="axis-label">${data[data.length - 1].year}</text>
    </svg>`;
    return;
  }

  let cumulative = data.map(() => 0);
  const areas = keys.map((key) => {
    const top = data.map((point, index) => cumulative[index] + point[key]);
    const bottom = [...cumulative];
    cumulative = top;
    const topPath = top.map((value, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(value)}`).join(" ");
    const bottomPath = bottom.map((value, index) => `L ${x(data.length - 1 - index)} ${y(bottom[data.length - 1 - index])}`).join(" ");
    return `<path d="${topPath} ${bottomPath} Z" fill="${SOURCE_COLOURS[key]}" opacity="0.42"></path>`;
  }).join("");
  const totalLine = totals.map((value, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(value)}`).join(" ");
  $("projectionChart").innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Projected asset growth chart">
    ${grid}
    ${areas}
    <path d="${totalLine}" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round"></path>
    <line x1="${width - pad.right}" y1="${pad.top}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#ffe17c" stroke-dasharray="5 6"/>
    <text x="${pad.left}" y="${height - 12}" class="axis-label">${data[0].year}</text>
    <text x="${width - pad.right - 36}" y="${height - 12}" class="axis-label">${data[data.length - 1].year}</text>
  </svg>`;
}

function polar(cx, cy, r, angle) {
  const radians = (angle - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(radians), y: cy + r * Math.sin(radians) };
}

function arcPath(cx, cy, r, start, end) {
  const s = polar(cx, cy, r, end);
  const e = polar(cx, cy, r, start);
  const large = end - start <= 180 ? 0 : 1;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`;
}

function renderDonut(result) {
  const incomeSources = [
    { key: "pension", label: "Pension", value: result.assets.pension * state.drawdownRate / 100 },
    { key: "isa", label: "ISA", value: result.assets.isa * state.drawdownRate / 100 },
    { key: "cash", label: "Cash", value: result.assets.cash * state.drawdownRate / 100 },
    { key: "other", label: "Other", value: result.assets.other * state.drawdownRate / 100 },
    { key: "state", label: "State Pension", value: result.stateAnnual },
  ].filter((item) => item.value > 1);
  const total = incomeSources.reduce((sum, item) => sum + item.value, 0) || 1;
  let angle = 0;
  const arcs = incomeSources.map((item) => {
    const slice = (item.value / total) * 360;
    const path = arcPath(95, 95, 66, angle, angle + slice);
    angle += slice;
    return `<path d="${path}" fill="none" stroke="${SOURCE_COLOURS[item.key]}" stroke-width="28" stroke-linecap="butt"></path>`;
  }).join("");
  $("donutChart").innerHTML = `<svg viewBox="0 0 190 190" role="img" aria-label="Income source breakdown">
    <circle cx="95" cy="95" r="66" fill="none" stroke="rgba(183,198,194,0.18)" stroke-width="28"></circle>
    ${arcs}
    <text x="95" y="90" text-anchor="middle" font-size="18" font-weight="900" fill="#ffffff">${money(total / 12)}</text>
    <text x="95" y="112" text-anchor="middle" font-size="12" font-weight="800" fill="#b7c6c2">per month</text>
  </svg>`;
  $("donutLegend").innerHTML = incomeSources.map((item) => `<div class="legend-item">
    <span class="legend-name"><span class="swatch" style="background:${SOURCE_COLOURS[item.key]}"></span>${item.label}</span>
    <span>${Math.round((item.value / total) * 100)}%</span>
  </div>`).join("");
}

function renderBenchmarks(result, status) {
  $("benchmarks").innerHTML = PLSA.map((benchmark) => {
    const ratio = Math.min(100, (result.annualIncome / benchmark.annual) * 100);
    const active = status.key === benchmark.key || result.annualIncome >= benchmark.annual;
    const missed = benchmark.key === "minimum" && result.annualIncome < benchmark.annual;
    return `<div class="benchmark ${active ? "active" : ""} ${missed ? "missed" : ""}">
      <span class="benchmark-name">${benchmark.label}</span>
      <span class="benchmark-bar"><span class="benchmark-fill" style="width:${ratio}%"></span></span>
      <span class="benchmark-value">${money(benchmark.annual)}/yr</span>
    </div>`;
  }).join("");
}

function renderPensionPots() {
  $("pensionPots").innerHTML = state.pensionPots.map((pot) => `<div class="asset-card" data-pot-id="${pot.id}">
    <div class="pot-heading">
      <input data-field="label" value="${pot.label}" aria-label="Pension pot label" />
      <button class="icon-button remove-button" data-action="remove-pot" type="button" title="Remove pension pot">-</button>
    </div>
    <label class="field small"><span>Current value</span><input data-field="value" type="number" min="0" step="500" value="${pot.value}" /></label>
    <label class="field small"><span>Monthly contribution</span><input data-field="monthly" type="number" min="0" step="25" value="${pot.monthly}" /></label>
    <label class="field small"><span>Growth rate</span><input data-field="growth" type="number" min="0" max="15" step="0.25" value="${pot.growth}" /></label>
  </div>`).join("");
}

function getOverviewRows(timeline) {
  const months = timeline.months;
  const years = timeline.yearsToRetirement;
  if (state.mode === "simple") {
    const monthly = (state.salary * (state.employeeContribution + state.employerContribution)) / 100 / 12;
    return [{
      name: "Projected pension",
      type: "Pension",
      current: state.existingPot,
      monthly,
      growth: state.simpleGrowth,
      retirement: deflate(futureValue(state.existingPot, monthly, state.simpleGrowth, months), years),
    }];
  }

  const rows = state.pensionPots.map((pot) => ({
    name: pot.label,
    type: "Pension",
    current: pot.value,
    monthly: pot.monthly,
    growth: pot.growth,
    retirement: deflate(futureValue(pot.value, pot.monthly, pot.growth, months), years),
  }));

  rows.push({
    name: "ISA Savings",
    type: "ISA",
    current: state.isaValue,
    monthly: state.isaMonthly,
    growth: state.isaGrowth,
    retirement: deflate(futureValue(state.isaValue, state.isaMonthly, state.isaGrowth, months), years),
  });
  rows.push({
    name: "Cash Savings",
    type: "Saving",
    current: state.cashValue,
    monthly: state.cashMonthly,
    growth: state.cashInterest,
    retirement: deflate(futureValue(state.cashValue, state.cashMonthly, state.cashInterest, months), years),
  });
  state.extraSavings.forEach((saving) => {
    rows.push({
      name: saving.label,
      type: "Saving",
      current: saving.value,
      monthly: saving.monthly,
      growth: saving.growth,
      retirement: deflate(futureValue(saving.value, saving.monthly, saving.growth, months), years),
    });
  });
  rows.push({
    name: "Other Investments",
    type: "Investment",
    current: state.otherValue,
    monthly: 0,
    growth: state.otherGrowth,
    retirement: deflate(futureValue(state.otherValue, 0, state.otherGrowth, months), years),
  });
  return rows;
}

function renderAssetOverview(result) {
  const rows = getOverviewRows(result.timeline).filter((row) => row.current > 0 || row.monthly > 0 || row.retirement > 0);
  $("overviewTermsLabel").textContent = state.realTerms ? "Today's money" : "Future money";
  if (rows.length === 0) {
    $("assetOverview").innerHTML = `<p class="overview-empty">Add a pension pot or saving to see the overview.</p>`;
    return;
  }
  $("assetOverview").innerHTML = `<div class="overview-row header">
    <span>Source</span>
    <span>Current value</span>
    <span>Monthly contribution</span>
    <span>Growth</span>
    <span>At retirement</span>
  </div>${rows.map((row) => `<div class="overview-row">
    <div class="overview-name">${escapeHtml(row.name)}<span class="overview-type">${row.type}</span></div>
    <div class="overview-value" data-label="Current value">${money(row.current)}</div>
    <div class="overview-value" data-label="Monthly contribution">${money(row.monthly)}</div>
    <div class="overview-value" data-label="Growth">${row.growth}%</div>
    <div class="overview-value" data-label="At retirement">${money(row.retirement)}</div>
  </div>`).join("")}`;
}

function renderExtraSavings() {
  $("extraSavings").innerHTML = state.extraSavings.map((saving) => `<div class="asset-card" data-saving-id="${saving.id}">
    <div class="pot-heading">
      <input data-field="label" value="${saving.label}" aria-label="Saving label" />
      <button class="icon-button remove-button" data-action="remove-saving" type="button" title="Remove saving">-</button>
    </div>
    <label class="field small"><span>Current value</span><input data-field="value" type="number" min="0" step="500" value="${saving.value}" /></label>
    <label class="field small"><span>Monthly contribution</span><input data-field="monthly" type="number" min="0" step="25" value="${saving.monthly}" /></label>
    <label class="field small"><span>Interest rate</span><input data-field="growth" type="number" min="0" max="10" step="0.25" value="${saving.growth}" /></label>
  </div>`).join("");
}

function render() {
  localStorage.setItem("retirementDashboardMode", state.mode);
  const result = calculate();
  const status = benchmarkStatus(result.annualIncome);
  const displayedIncome = state.incomeView === "monthly" ? result.monthlyIncome : result.annualIncome;
  const displayedSuffix = state.incomeView === "monthly" ? "/month" : "/year";
  const target = status.next;
  const monthlyGap = target ? Math.max(0, target.annual / 12 - result.monthlyIncome) : 0;
  const extraMonthly = target ? estimateExtraMonthlyNeeded(target.annual, result.annualIncome, result.timeline.yearsToRetirement) : 0;

  $("simpleMode").classList.toggle("active", state.mode === "simple");
  $("advancedMode").classList.toggle("active", state.mode === "advanced");
  $("monthlyView").classList.toggle("active", state.incomeView === "monthly");
  $("annualView").classList.toggle("active", state.incomeView === "annual");
  $("simpleInputs").classList.toggle("hidden", state.mode !== "simple");
  $("advancedInputs").classList.toggle("hidden", state.mode !== "advanced");

  $("dob").value = state.dob;
  $("retirementAge").value = state.retirementAge;
  $("retirementAgeValue").textContent = `${state.retirementAge}`;
  $("yearsToRetirement").textContent = result.timeline.yearsToRetirement;
  $("retirementDateLabel").textContent = result.timeline.retirementDate.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  $("salary").value = state.salary;
  $("employeeContribution").value = state.employeeContribution;
  $("employeeContributionValue").textContent = `${state.employeeContribution}%`;
  $("employerContribution").value = state.employerContribution;
  $("employerContributionValue").textContent = `${state.employerContribution}%`;
  $("simpleGrowth").value = state.simpleGrowth;
  $("simpleGrowthValue").textContent = `${state.simpleGrowth}%`;
  $("existingPot").value = state.existingPot;
  $("realTerms").checked = state.realTerms;
  $("realTermsLabel").textContent = state.realTerms ? "Today's money" : "Future money";

  ["isaValue", "isaMonthly", "isaGrowth", "cashValue", "cashMonthly", "cashInterest", "otherValue", "otherGrowth", "stateForecastWeekly", "niYears", "stateManualWeekly", "drawdownRate", "inflationRate"].forEach((id) => {
    $(id).value = state[id];
  });
  document.querySelectorAll("input[name='statePensionMode']").forEach((input) => {
    input.checked = input.value === state.statePensionMode;
  });
  $("forecastInputWrap").classList.toggle("hidden", state.statePensionMode !== "forecast");
  $("niInputWrap").classList.toggle("hidden", state.statePensionMode !== "ni");
  $("manualInputWrap").classList.toggle("hidden", state.statePensionMode !== "manual");
  $("stateWarning").classList.toggle("hidden", state.retirementAge >= STATE_PENSION_AGE);

  $("heroIncome").textContent = `${money(displayedIncome)}${displayedSuffix}`;
  $("annualIncomeLabel").textContent = `${money(result.annualIncome)} per year`;
  $("statusPill").textContent = status.label === "Below minimum" ? "Below minimum" : `Tracking toward ${status.label}`;
  $("statusPill").className = `status-pill ${status.key}`;
  $("monthlyGap").textContent = target ? money(monthlyGap) : "£0";
  $("whatIfPrompt").textContent = target
    ? `Increase contributions by about ${money(extraMonthly)}/month to reach ${target.label}.`
    : "You are above the comfortable benchmark in this scenario.";
  $("potAtRetirement").textContent = `${money(result.totalPot)} total pot`;

  renderAssetOverview(result);
  renderBenchmarks(result, status);
  renderProjectionChart(buildProjectionData(result.timeline));
  renderDonut(result);
}

function bindInputs() {
  const numericIds = ["retirementAge", "salary", "employeeContribution", "employerContribution", "simpleGrowth", "existingPot", "isaValue", "isaMonthly", "isaGrowth", "cashValue", "cashMonthly", "cashInterest", "otherValue", "otherGrowth", "stateForecastWeekly", "niYears", "stateManualWeekly", "drawdownRate", "inflationRate"];
  numericIds.forEach((id) => {
    $(id).addEventListener("input", (event) => {
      state[id] = Number(event.target.value);
      render();
    });
  });
  $("dob").addEventListener("input", (event) => {
    state.dob = event.target.value;
    render();
  });
  $("realTerms").addEventListener("change", (event) => {
    state.realTerms = event.target.checked;
    render();
  });
  $("simpleMode").addEventListener("click", () => {
    state.mode = "simple";
    render();
  });
  $("advancedMode").addEventListener("click", () => {
    state.mode = "advanced";
    render();
  });
  $("monthlyView").addEventListener("click", () => {
    state.incomeView = "monthly";
    render();
  });
  $("annualView").addEventListener("click", () => {
    state.incomeView = "annual";
    render();
  });
  $("openPlanner").addEventListener("click", () => {
    $("planner").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("openStandards").addEventListener("click", () => {
    $("benchmarks").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.querySelectorAll("input[name='statePensionMode']").forEach((input) => {
    input.addEventListener("change", (event) => {
      state.statePensionMode = event.target.value;
      render();
    });
  });
  $("addPensionPot").addEventListener("click", () => {
    state.pensionPots.push({ id: createId(), label: "New pension pot", value: 0, monthly: 100, growth: 5 });
    $("assetChooser").classList.add("hidden");
    renderPensionPots();
    render();
  });
  $("showAssetChooser").addEventListener("click", () => {
    $("assetChooser").classList.toggle("hidden");
  });
  $("addSaving").addEventListener("click", () => {
    state.extraSavings.push({ id: createId(), label: "New saving", value: 0, monthly: 100, growth: state.cashInterest });
    $("assetChooser").classList.add("hidden");
    renderExtraSavings();
    render();
  });
  $("pensionPots").addEventListener("input", (event) => {
    const card = event.target.closest("[data-pot-id]");
    if (!card) return;
    const pot = state.pensionPots.find((item) => item.id === card.dataset.potId);
    const field = event.target.dataset.field;
    pot[field] = field === "label" ? event.target.value : Number(event.target.value);
    render();
  });
  $("pensionPots").addEventListener("click", (event) => {
    if (event.target.dataset.action !== "remove-pot") return;
    const card = event.target.closest("[data-pot-id]");
    state.pensionPots = state.pensionPots.filter((item) => item.id !== card.dataset.potId);
    renderPensionPots();
    render();
  });
  $("extraSavings").addEventListener("input", (event) => {
    const card = event.target.closest("[data-saving-id]");
    if (!card) return;
    const saving = state.extraSavings.find((item) => item.id === card.dataset.savingId);
    const field = event.target.dataset.field;
    saving[field] = field === "label" ? event.target.value : Number(event.target.value);
    render();
  });
  $("extraSavings").addEventListener("click", (event) => {
    if (event.target.dataset.action !== "remove-saving") return;
    const card = event.target.closest("[data-saving-id]");
    state.extraSavings = state.extraSavings.filter((item) => item.id !== card.dataset.savingId);
    renderExtraSavings();
    render();
  });
}

renderPensionPots();
renderExtraSavings();
bindInputs();
render();
