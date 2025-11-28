/* global d3, topojson */
(function () {
  if (!window.d3) {
    console.error("D3.js is required for this dashboard.");
    return;
  }

  const tooltipSelection = d3.select("body").select(".tooltip");
  const tooltip = tooltipSelection.empty()
    ? d3.select("body").append("div").attr("class", "tooltip")
    : tooltipSelection;

  const numberFmt = d3.format(".1f");
  const percentFmt = d3.format(".1%");
  const controllers = {};

  async function init() {
    try {
      const [
        leagueTrends,
        scoringMix,
        teamScatter,
        heatmapData,
        teamMapData,
        spiralData,
        statesTopo,
      ] = await Promise.all([
        fetch("data/league_trends.json").then((res) => res.json()),
        fetch("data/scoring_mix.json").then((res) => res.json()),
        fetch("data/team_scatter.json").then((res) => res.json()),
        fetch("data/three_heatmap.json").then((res) => res.json()),
        fetch("data/team_map.json").then((res) => res.json()),
        fetch("data/momentum_spiral.json").then((res) => res.json()),
        d3.json("data/us_states_topo.json"),
      ]);

      updateHeroMetrics(leagueTrends);
      controllers.league = renderLeagueTrends(leagueTrends);
      controllers.scoring = renderScoringMix(scoringMix);
      controllers.scatter = renderTeamScatter(teamScatter);
      controllers.heatmap = renderHeatmap(heatmapData);
      controllers.map = renderTeamMap(teamMapData, statesTopo);
      controllers.spiral = renderMomentumSpiral(spiralData);

      setupStorySteps();
    } catch (err) {
      console.error("Failed to boot dashboard", err);
    }
  }

  function setupStorySteps() {
    const steps = Array.from(document.querySelectorAll(".story-step"));
    if (!steps.length) return;

    const activateStep = (step) => {
      if (!step) return;
      const parent = step.parentElement;
      parent?.querySelectorAll(".story-step").forEach((el) =>
        el.classList.toggle("active", el === step)
      );
      const story = parent?.dataset.story;
      const season = step.dataset.season ? Number(step.dataset.season) : null;
      const metric = step.dataset.metric || null;
      const team = step.dataset.team || null;
      const conference = step.dataset.conference || null;

      switch (story) {
        case "league":
          controllers.league?.setMetric(metric);
          if (season) controllers.league?.focusSeason(season);
          break;
        case "scoring":
          if (season) controllers.scoring?.focusSeason(season);
          break;
        case "scatter":
          if (season) controllers.scatter?.setSeason(season);
          break;
        case "heatmap":
          controllers.heatmap?.highlight({ team, season });
          break;
        case "map":
          controllers.map?.focusConference(conference || null);
          break;
        case "spiral":
          if (season) controllers.spiral?.focusSeason(season);
          break;
        default:
          break;
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries
          .filter((entry) => entry.isIntersecting)
          .forEach((entry) => activateStep(entry.target));
      },
      { rootMargin: "-30% 0px -30% 0px", threshold: 0.6 }
    );

    steps.forEach((step) => {
      observer.observe(step);
      step.addEventListener("click", () => activateStep(step));
    });

    const grouped = d3.group(steps, (s) => s.parentElement);
    grouped.forEach((groupSteps) => {
      const defaultStep =
        groupSteps.find((s) => s.classList.contains("active")) ||
        groupSteps[0];
      if (defaultStep) activateStep(defaultStep);
    });
  }

  function updateHeroMetrics(data) {
    if (!data.length) return;
    const sorted = data.slice().sort((a, b) => a.season - b.season);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const growth =
      ((last.avgThreeRate - first.avgThreeRate) / first.avgThreeRate) * 100;
    d3.select("#avgGrowth").text(
      `${growth >= 0 ? "+" : ""}${numberFmt(growth)}`
    );
  }

  function renderLeagueTrends(rawData) {
    const data = rawData.slice().sort((a, b) => a.season - b.season);
    const container = d3.select("#leagueTrendChart");
    container.selectAll("*").remove();
    const bounds = container.node().getBoundingClientRect();
    const width = bounds.width || 960;
    const height = 420;
    const margin = { top: 30, right: 40, bottom: 50, left: 60 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const metricConfig = [
      {
        key: "avgThreeAttempts",
        label: "3PA per team game",
        color: "#f25f5c",
        accessor: (d) => d.avgThreeAttempts,
        format: (d) => `${numberFmt(d)}`,
        suffix: " attempts",
      },
      {
        key: "avgPoints",
        label: "Points per team game",
        color: "#60d2ff",
        accessor: (d) => d.avgPoints,
        format: (d) => `${numberFmt(d)}`,
        suffix: " pts",
      },
      {
        key: "avgThreeRate",
        label: "Share of FGA that are 3s",
        color: "#c4ff5f",
        accessor: (d) => d.avgThreeRate * 100,
        format: (d) => `${numberFmt(d)}%`,
        suffix: "",
      },
    ];

    const accessorMax = d3.max(metricConfig, (metric) =>
      d3.max(data, (d) => metric.accessor(d))
    );

    const x = d3
      .scaleLinear()
      .domain(d3.extent(data, (d) => d.season))
      .range([0, innerWidth]);

    const y = d3
      .scaleLinear()
      .domain([0, accessorMax * 1.1])
      .range([innerHeight, 0]);

    const line = d3
      .line()
      .x((d) => x(d.season))
      .y((d) => y(d.value))
      .curve(d3.curveCatmullRom.alpha(0.5));

    const svg = container
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const formatYear = d3.format("d");

    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(10).tickFormat(formatYear));

    g.append("g").call(d3.axisLeft(y).ticks(6));

    g.append("g")
      .attr("class", "grid")
      .call(
        d3
          .axisLeft(y)
          .ticks(6)
          .tickSize(-innerWidth)
          .tickFormat("")
      )
      .attr("stroke-opacity", 0.05);

    const metricData = metricConfig.map((metric) => ({
      ...metric,
      values: data.map((d) => ({ season: d.season, value: metric.accessor(d) })),
    }));

    const linesGroup = g.append("g").attr("class", "metric-lines");

    const pathSelection = linesGroup
      .selectAll("path")
      .data(metricData)
      .join("path")
      .attr("fill", "none")
      .attr("stroke", (d) => d.color)
      .attr("stroke-width", 2.5)
      .attr("opacity", 0.85)
      .attr("d", (d) => line(d.values))
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round");

    const focusGroup = g.append("g").attr("class", "focus-group");

    const focusDots = focusGroup
      .selectAll("circle")
      .data(metricData)
      .join("circle")
      .attr("r", 4.5)
      .attr("fill", (d) => d.color)
      .attr("stroke", "#090b17")
      .attr("stroke-width", 2)
      .attr("opacity", 0);

    const crosshair = focusGroup
      .append("line")
      .attr("stroke", "rgba(255,255,255,0.35)")
      .attr("stroke-width", 1)
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .attr("opacity", 0);

    const bisect = d3.bisector((d) => d.season).center;
    let activeMetric = null;

    function showTooltip(datum) {
      const rows = metricData
        .filter((metric) => !activeMetric || activeMetric === metric.key)
        .map(
          (metric) =>
            `<span style="color:${metric.color}">${metric.label}:</span> ${metric.format(
              metric.accessor(datum)
            )}${metric.suffix}`
        )
        .join("<br>");

      const rect = container.node().getBoundingClientRect();
      tooltip
        .classed("show", true)
        .html(`<strong>${datum.season}</strong><br>${rows}`)
        .style("left", `${rect.x + margin.left + x(datum.season) + 20}px`)
        .style("top", `${rect.y + margin.top + 10}px`);
    }

    function pointerMove(event) {
      const [mx] = d3.pointer(event);
      const seasonValue = x.invert(mx);
      const index = bisect(data, seasonValue);
      const datum = data[index];
      if (!datum) return;

      crosshair
        .attr("x1", x(datum.season))
        .attr("x2", x(datum.season))
        .attr("opacity", 1);

      focusDots
        .attr("cx", x(datum.season))
        .attr("cy", (d) => y(d.accessor(datum)))
        .attr("opacity", (d) =>
          activeMetric && activeMetric !== d.key ? 0 : 1
        );

      showTooltip(datum);
    }

    function pointerLeave() {
      tooltip.classed("show", false);
      focusDots.attr("opacity", 0);
      crosshair.attr("opacity", 0);
    }

    g.append("rect")
      .attr("fill", "transparent")
      .attr("pointer-events", "all")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .on("pointermove", pointerMove)
      .on("pointerleave", pointerLeave);

    const legend = d3.select("#trendLegend");

    const buttons = legend
      .selectAll("button")
      .data(metricData)
      .join("button")
      .attr("type", "button")
      .attr("style", (d) => `color:${d.color}`)
      .html((d) => `<span class="dot"></span><span>${d.label}</span>`)
      .on("click", (_, metric) => {
        activeMetric = activeMetric === metric.key ? null : metric.key;
        updateMetricFilter();
      });

    function updateMetricFilter() {
      buttons.classed("active", (d) => !activeMetric || activeMetric === d.key);

      pathSelection
        .transition()
        .duration(300)
        .attr("opacity", (d) =>
          !activeMetric || activeMetric === d.key ? 0.95 : 0.12
        )
        .attr("stroke-width", (d) =>
          activeMetric && activeMetric === d.key ? 3.4 : 2.2
        );
    }

    updateMetricFilter();

    function setMetric(key) {
      activeMetric = key;
      updateMetricFilter();
    }

    function focusSeason(season) {
      const datum =
        data.find((d) => d.season === season) || data[data.length - 1];
      crosshair
        .attr("x1", x(datum.season))
        .attr("x2", x(datum.season))
        .attr("opacity", 1);
      focusDots
        .attr("cx", x(datum.season))
        .attr("cy", (d) => y(d.accessor(datum)))
        .attr("opacity", (d) =>
          activeMetric && activeMetric !== d.key ? 0 : 1
        );
      showTooltip(datum);
    }

    return { setMetric, focusSeason };
  }

  function renderScoringMix(rawData) {
    const data = rawData.slice().sort((a, b) => a.season - b.season);
    const container = d3.select("#scoringMixChart");
    container.selectAll("*").remove();
    const bounds = container.node().getBoundingClientRect();
    const width = bounds.width || 960;
    const height = 420;
    const margin = { top: 20, right: 30, bottom: 50, left: 60 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const keys = [
      { key: "twoPct", label: "Points from 2s", color: "#60d2ff" },
      { key: "threePct", label: "Points from 3s", color: "#f25f5c" },
      { key: "ftPct", label: "Points from FT", color: "#c4ff5f" },
    ];

    const stackGen = d3
      .stack()
      .keys(keys.map((k) => k.key))
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);
    const stackedData = stackGen(data);

    const x = d3
      .scaleLinear()
      .domain(d3.extent(data, (d) => d.season))
      .range([0, innerWidth]);
    const y = d3.scaleLinear().domain([0, 1]).range([innerHeight, 0]);
    const area = d3
      .area()
      .x((d) => x(d.data.season))
      .y0((d) => y(d[0]))
      .y1((d) => y(d[1]))
      .curve(d3.curveCatmullRom.alpha(0.7));

    const svg = container
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const yearFmt = d3.format("d");
    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(10).tickFormat(yearFmt));
    g.append("g")
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickFormat((d) => `${Math.round(d * 100)}%`)
      )
      .call((sel) =>
        sel.selectAll(".tick line").attr("x2", innerWidth).attr("stroke-opacity", 0.05)
      );

    const layers = g
      .selectAll(".layer")
      .data(stackedData)
      .join("path")
      .attr("class", "layer")
      .attr("fill", (_, i) => keys[i].color)
      .attr("opacity", 0.9)
      .attr("d", area)
      .attr("stroke", "rgba(9,11,23,0.5)")
      .attr("stroke-width", 0.5);

    layers
      .attr("opacity", 0)
      .transition()
      .duration(900)
      .delay((_, i) => i * 120)
      .attr("opacity", 0.9);

    const bisect = d3.bisector((d) => d.season).center;
    const focusLine = g
      .append("line")
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .attr("stroke", "rgba(255,255,255,0.35)")
      .attr("stroke-width", 1)
      .attr("opacity", 0);

    function showSeason(datum) {
      const rows = keys
        .map(
          ({ key, label, color }) =>
            `<span style="color:${color}">${label}:</span> ${percentFmt(datum[key])}`
        )
        .join("<br>");
      const rect = container.node().getBoundingClientRect();
      tooltip
        .classed("show", true)
        .html(`<strong>${datum.season}</strong><br>${rows}`)
        .style("left", `${rect.x + margin.left + x(datum.season) + 20}px`)
        .style("top", `${rect.y + margin.top + 10}px`);

      focusLine
        .attr("x1", x(datum.season))
        .attr("x2", x(datum.season))
        .attr("opacity", 1);
    }

    g.append("rect")
      .attr("fill", "transparent")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .on("pointermove", (event) => {
        const [mx] = d3.pointer(event);
        const seasonValue = x.invert(mx);
        const index = bisect(data, seasonValue);
        const datum = data[index];
        if (!datum) return;
        showSeason(datum);
      })
      .on("pointerleave", () => {
        tooltip.classed("show", false);
        focusLine.attr("opacity", 0);
      });

    function focusSeason(season) {
      const datum =
        data.find((d) => d.season === season) || data[data.length - 1];
      showSeason(datum);
    }

    return { focusSeason };
  }

  function renderTeamScatter(rawData) {
    const data = rawData.filter((d) => d.avgThreeAttempts && d.threePct);
    const container = d3.select("#teamScatter");
    container.selectAll("*").remove();
    const bounds = container.node().getBoundingClientRect();
    const width = bounds.width || 960;
    const height = 460;
    const margin = { top: 20, right: 20, bottom: 60, left: 70 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const seasons = Array.from(new Set(data.map((d) => d.season))).sort(
      (a, b) => a - b
    );
    const seasonGroups = d3.group(data, (d) => d.season);

    const x = d3
      .scaleLinear()
      .domain(d3.extent(data, (d) => d.avgThreeAttempts))
      .nice()
      .range([0, innerWidth]);
    const y = d3
      .scaleLinear()
      .domain([
        d3.min(data, (d) => d.threePct) * 100 - 2,
        d3.max(data, (d) => d.threePct) * 100 + 2,
      ])
      .range([innerHeight, 0]);
    const r = d3.scaleSqrt().domain([0.2, 0.8]).range([4, 22]);
    const color = d3
      .scaleOrdinal()
      .domain(["East", "West"])
      .range(["#60d2ff", "#f25f5c"])
      .unknown("#ffffff");

    const svg = container
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x))
      .append("text")
      .attr("x", innerWidth / 2)
      .attr("y", 45)
      .attr("fill", "#fff")
      .attr("text-anchor", "middle")
      .text("Average 3PA per team game");
    g.append("g")
      .call(
        d3
          .axisLeft(y)
          .ticks(6)
          .tickFormat((d) => `${numberFmt(d)}%`)
      )
      .append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -(innerHeight / 2))
      .attr("y", -50)
      .attr("fill", "#fff")
      .attr("text-anchor", "middle")
      .text("3P Accuracy");
    g.append("g")
      .attr("class", "grid")
      .call(
        d3
          .axisLeft(y)
          .ticks(6)
          .tickSize(-innerWidth)
          .tickFormat("")
      )
      .attr("stroke-opacity", 0.04);

    const scatterLayer = g.append("g");
    const slider = document.getElementById("seasonSlider");
    const label = document.getElementById("seasonLabel");
    const insight = document.getElementById("teamInsight");

    if (!slider || !label || !insight) {
      console.warn("Missing slider elements for the team scatter chart.");
      return {};
    }

    if (seasons.length) {
      slider.min = seasons[0];
      slider.max = seasons[seasons.length - 1];
      slider.value = seasons[seasons.length - 1];
      label.textContent = slider.value;
    }

    function updateSeason(season) {
      const year = Number(season);
      label.textContent = year;
      const seasonData = seasonGroups.get(year) || [];
      const bubbles = scatterLayer.selectAll("circle").data(
        seasonData,
        (d) => d.teamId
      );

      bubbles
        .join(
          (enter) =>
            enter
              .append("circle")
              .attr("cx", (d) => x(d.avgThreeAttempts))
              .attr("cy", (d) => y(d.threePct * 100))
              .attr("r", 0)
              .attr("fill", (d) => color(d.conference))
              .attr("fill-opacity", 0.85)
              .attr("stroke", "rgba(9,11,23,0.7)")
              .attr("stroke-width", 1.5)
              .call((enterSel) =>
                enterSel
                  .transition()
                  .duration(600)
                  .attr("r", (d) => r(d.winPct ?? 0.5))
              ),
          (update) =>
            update.call((updateSel) =>
              updateSel
                .transition()
                .duration(550)
                .attr("cx", (d) => x(d.avgThreeAttempts))
                .attr("cy", (d) => y(d.threePct * 100))
                .attr("r", (d) => r(d.winPct ?? 0.5))
            ),
          (exit) =>
            exit.call((exitSel) =>
              exitSel.transition().duration(300).attr("r", 0).remove()
            )
        )
        .on("pointerenter", function (event, d) {
          d3.select(this)
            .transition()
            .duration(150)
            .attr("stroke-width", 3)
            .attr("fill-opacity", 1);
          tooltip
            .classed("show", true)
            .html(
              `<strong>${d.city} ${d.team || ""}</strong><br>${numberFmt(
                d.avgThreeAttempts
              )} 3PA • ${numberFmt(d.threePct * 100)}%<br>Win %: ${
                d.winPct ? numberFmt(d.winPct * 100) + "%" : "N/A"
              }`
            )
            .style("left", `${event.clientX + 15}px`)
            .style("top", `${event.clientY - 10}px`);
        })
        .on("pointermove", (event) => {
          tooltip
            .style("left", `${event.clientX + 15}px`)
            .style("top", `${event.clientY - 10}px`);
        })
        .on("pointerleave", function () {
          d3.select(this)
            .transition()
            .duration(150)
            .attr("stroke-width", 1.5)
            .attr("fill-opacity", 0.85);
          tooltip.classed("show", false);
        });

      const topTeam = d3.greatest(seasonData, (d) => d.winPct ?? 0);
      if (topTeam) {
        const name = `${topTeam.city} ${topTeam.team}`.trim();
        insight.textContent = `${name} combined ${numberFmt(
          topTeam.avgThreeAttempts
        )} 3PA and ${numberFmt(topTeam.threePct * 100)}% accuracy for ${
          topTeam.winPct ? numberFmt(topTeam.winPct * 100) + "% wins." : "a winning profile."
        }`;
      } else {
        insight.textContent = "No team data for this season.";
      }
    }

    slider.addEventListener("input", (event) => updateSeason(event.target.value));
    document.querySelectorAll(".slider-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = Number(btn.dataset.dir);
        const next = Math.min(
          Number(slider.max),
          Math.max(Number(slider.min), Number(slider.value) + dir)
        );
        slider.value = next;
        updateSeason(next);
      });
    });

    if (slider.value) {
      updateSeason(slider.value);
    }

    return {
      setSeason: (season) => {
        slider.value = season;
        updateSeason(season);
      },
    };
  }

  function renderHeatmap(rawData) {
    const data = rawData.slice();
    const container = d3.select("#heatmapChart");
    container.selectAll("*").remove();
    const bounds = container.node().getBoundingClientRect();
    const width = bounds.width || 960;
    const margin = { top: 20, right: 20, bottom: 60, left: 90 };

    const seasons = Array.from(new Set(data.map((d) => d.season))).sort(
      (a, b) => a - b
    );
    const latestSeason = Math.max(...seasons);
    const teamLatest = d3.rollup(
      data.filter((d) => d.season === latestSeason),
      (v) => v[0],
      (d) => d.abbr
    );
    const teams = Array.from(new Set(data.map((d) => d.abbr))).sort(
      (a, b) => {
        const aRate = teamLatest.get(a)?.threeRate ?? 0;
        const bRate = teamLatest.get(b)?.threeRate ?? 0;
        return d3.descending(aRate, bRate);
      }
    );

    const cellHeight = 24;
    const innerHeight = teams.length * cellHeight;
    const height = innerHeight + margin.top + margin.bottom;

    const x = d3
      .scaleBand()
      .domain(seasons)
      .range([0, width - margin.left - margin.right])
      .padding(0.05);
    const y = d3
      .scaleBand()
      .domain(teams)
      .range([0, innerHeight])
      .padding(0.08);

    const rates = data.map((d) => d.threeRate);
    const color = d3
      .scaleSequential(d3.interpolateTurbo)
      .domain([d3.min(rates), d3.max(rates)]);

    const svg = container
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(seasons.filter((_, i) => i % 2 === 0))
          .tickFormat(d3.format("d"))
      );

    g.append("g").call(d3.axisLeft(y));

    const cells = g
      .selectAll("rect")
      .data(data, (d) => `${d.season}-${d.abbr}`)
      .join("rect")
      .attr("x", (d) => x(d.season))
      .attr("y", (d) => y(d.abbr))
      .attr("width", x.bandwidth())
      .attr("height", y.bandwidth())
      .attr("rx", 4)
      .attr("fill", (d) => color(d.threeRate))
      .attr("opacity", 0.92)
      .on("pointerenter", function (event, d) {
        d3.select(this).attr("opacity", 1);
        tooltip
          .classed("show", true)
          .html(
            `<strong>${d.city} ${d.team}</strong><br>${d.season}<br>${percentFmt(
              d.threeRate
            )} of attempts were 3s<br>${numberFmt(d.threePct * 100)}% accuracy`
          )
          .style("left", `${event.clientX + 15}px`)
          .style("top", `${event.clientY - 10}px`);
      })
      .on("pointerleave", function () {
        d3.select(this).attr("opacity", 0.92);
        tooltip.classed("show", false);
      });

    const legend = d3
      .select("#three-heatmap .story-viz")
      .insert("div", ":first-child")
      .attr("class", "heat-legend");
    legend.append("span").text("Lower 3P share");
    legend.append("div").attr("class", "bar");
    legend.append("span").text("Higher 3P share");

    function highlight({ team, season }) {
      cells
        .transition()
        .duration(300)
        .attr("opacity", (d) => {
          const teamMatch = team ? d.abbr === team : true;
          const seasonMatch = season ? d.season === Number(season) : true;
          return teamMatch && seasonMatch ? 1 : 0.25;
        });
    }

    return { highlight };
  }

  function renderTeamMap(teamData, statesTopo) {
    const container = d3.select("#teamMap");
    container.selectAll("*").remove();
    const bounds = container.node().getBoundingClientRect();
    const width = bounds.width || 960;
    const height = 520;
    const margin = { top: 10, right: 10, bottom: 10, left: 10 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const states =
      topojson && statesTopo?.objects
        ? topojson.feature(statesTopo, statesTopo.objects.states)
        : null;

    let projection = d3
      .geoAlbersUsa()
      .translate([innerWidth / 2, innerHeight / 2])
      .scale(innerWidth * 1.1);
    if (states) {
      projection = d3.geoAlbersUsa().fitSize([innerWidth, innerHeight], states);
    }
    const path = d3.geoPath(projection);

    const svg = container
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    const defs = svg.append("defs");
    const grad = defs
      .append("linearGradient")
      .attr("id", "mapGrad")
      .attr("x1", "0%")
      .attr("x2", "100%")
      .attr("y1", "0%")
      .attr("y2", "100%");
    grad.append("stop").attr("offset", "0%").attr("stop-color", "#60d2ff");
    grad.append("stop").attr("offset", "100%").attr("stop-color", "#f25f5c");

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    g.append("rect")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .attr("fill", "url(#mapGrad)")
      .attr("opacity", 0.12);

    if (states) {
      g.append("g")
        .selectAll("path")
        .data(states.features)
        .join("path")
        .attr("d", path)
        .attr("fill", "rgba(255,255,255,0.03)")
        .attr("stroke", "rgba(255,255,255,0.08)")
        .attr("stroke-width", 0.6);
    }

    const positioned = teamData
      .map((d) => {
        const coords = projection([d.lon, d.lat]);
        return coords ? { ...d, coords } : null;
      })
      .filter(Boolean);

    const extentOff = d3.extent(positioned, (d) => d.offRtg);
    const r = d3.scaleSqrt().domain(extentOff).range([6, 24]);
    const color = d3
      .scaleOrdinal()
      .domain(["East", "West"])
      .range(["#60d2ff", "#f25f5c"]);
    const glow = d3
      .scaleLinear()
      .domain(d3.extent(positioned, (d) => d.threeRate))
      .range([0.25, 0.9]);

    const bubbles = g
      .append("g")
      .selectAll("circle")
      .data(positioned)
      .join("circle")
      .attr("class", "map-bubble")
      .attr("cx", (d) => d.coords[0])
      .attr("cy", (d) => d.coords[1])
      .attr("r", (d) => r(d.offRtg))
      .attr("fill", (d) => color(d.conference))
      .attr("fill-opacity", (d) => glow(d.threeRate))
      .attr("stroke", "rgba(9,11,23,0.65)")
      .attr("stroke-width", 1.5)
      .on("pointerenter", function (event, d) {
        d3.select(this)
          .transition()
          .duration(150)
          .attr("stroke-width", 3)
          .attr("fill-opacity", 1);
        tooltip
          .classed("show", true)
          .html(
            `<strong>${d.city} ${d.team}</strong><br>Off Rtg: ${numberFmt(
              d.offRtg
            )}<br>3P Rate: ${percentFmt(d.threeRate)}<br>3P%: ${numberFmt(
              d.threePct * 100
            )}%`
          )
          .style("left", `${event.clientX + 15}px`)
          .style("top", `${event.clientY - 10}px`);
      })
      .on("pointermove", (event) => {
        tooltip
          .style("left", `${event.clientX + 15}px`)
          .style("top", `${event.clientY - 10}px`);
      })
      .on("pointerleave", function () {
        d3.select(this)
          .transition()
          .duration(150)
          .attr("stroke-width", 1.5)
          .attr("fill-opacity", (d) => glow(d.threeRate));
        tooltip.classed("show", false);
      });

    const best = d3.greatest(positioned, (d) => d.offRtg);
    if (best) {
      const [bx, by] = projection([best.lon, best.lat]);
      g.append("text")
        .attr("x", bx)
        .attr("y", by - r(best.offRtg) - 6)
        .attr("fill", "#fff")
        .attr("text-anchor", "middle")
        .attr("font-size", 12)
        .text("Top offense");
    }

    function focusConference(conference) {
      bubbles
        .transition()
        .duration(300)
        .attr("opacity", (d) =>
          !conference || d.conference === conference ? 1 : 0.2
        )
        .attr("r", (d) =>
          !conference || d.conference === conference ? r(d.offRtg) : r(d.offRtg) * 0.8
        );
    }

    return { focusConference };
  }

  function renderMomentumSpiral(rawData) {
    const data = rawData.slice().sort((a, b) => a.season - b.season);
    const container = d3.select("#momentumSpiral");
    container.selectAll("*").remove();
    const bounds = container.node().getBoundingClientRect();
    const width = bounds.width || 860;
    const height = 520;
    const center = [width / 2, height / 2];

    const angleStep = Math.PI / 3.2; // graceful spiral cadence
    const radiusScale = d3
      .scaleLinear()
      .domain(d3.extent(data, (d) => d.momentum))
      .range([40, 210]);
    const color = d3
      .scaleSequential(d3.interpolateTurbo)
      .domain(d3.extent(data, (d) => d.avgThreePct));

    const radialLine = d3
      .lineRadial()
      .angle((_, i) => i * angleStep)
      .radius((d, i) => radiusScale(d.momentum) + i * 8)
      .curve(d3.curveCatmullRom.alpha(0.85));

    const svg = container
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    const g = svg
      .append("g")
      .attr("transform", `translate(${center[0]},${center[1]})`);

    const ringLevels = [80, 140, 200, 260];
    g.append("g")
      .selectAll("circle")
      .data(ringLevels)
      .join("circle")
      .attr("r", (d) => d)
      .attr("fill", "none")
      .attr("stroke", "rgba(255,255,255,0.05)")
      .attr("stroke-dasharray", "4 6");

    const spiralPath = g
      .append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", "#f7f7ff")
      .attr("stroke-width", 1.2)
      .attr("stroke-opacity", 0.4)
      .attr("d", radialLine);

    const dots = g
      .selectAll(".spiral-dot")
      .data(data)
      .join("circle")
      .attr("class", "spiral-dot")
      .attr("cx", (d, i) => d3.pointRadial(i * angleStep, radiusScale(d.momentum) + i * 8)[0])
      .attr("cy", (d, i) => d3.pointRadial(i * angleStep, radiusScale(d.momentum) + i * 8)[1])
      .attr("r", 5)
      .attr("fill", (d) => color(d.avgThreePct))
      .attr("stroke", "rgba(9,11,23,0.7)")
      .attr("stroke-width", 1.5)
      .on("pointerenter", function (event, d) {
        d3.select(this).attr("r", 8);
        tooltip
          .classed("show", true)
          .html(
            `<strong>${d.season}</strong><br>Momentum idx: ${numberFmt(
              d.momentum * 100
            )}<br>3P Rate: ${percentFmt(d.avgThreeRate)}<br>3P%: ${numberFmt(
              d.avgThreePct * 100
            )}%`
          )
          .style("left", `${event.clientX + 15}px`)
          .style("top", `${event.clientY - 10}px`);
      })
      .on("pointermove", (event) => {
        tooltip
          .style("left", `${event.clientX + 15}px`)
          .style("top", `${event.clientY - 10}px`);
      })
      .on("pointerleave", function () {
        d3.select(this).attr("r", 5);
        tooltip.classed("show", false);
      });

    const label = g
      .append("text")
      .attr("class", "spiral-label")
      .attr("y", -10)
      .text("");

    function focusSeason(season) {
      const datum =
        data.find((d) => d.season === season) || data[data.length - 1];
      dots
        .transition()
        .duration(250)
        .attr("r", (d) => (d === datum ? 9 : 5))
        .attr("opacity", (d) => (d === datum ? 1 : 0.55));

      const idx = data.indexOf(datum);
      const [x, y] = d3.pointRadial(
        idx * angleStep,
        radiusScale(datum.momentum) + idx * 8
      );
      label
        .attr("x", x)
        .attr("y", y - 14)
        .text(`${datum.season} momentum wave`);
    }

    // gentle intro animation
    spiralPath
      .attr("stroke-dasharray", "2000")
      .attr("stroke-dashoffset", 2000)
      .transition()
      .duration(1600)
      .ease(d3.easeCubicInOut)
      .attr("stroke-dashoffset", 0);

    focusSeason(data[0]?.season);
    return { focusSeason };
  }

  window.addEventListener("DOMContentLoaded", init);
})();
