/* global d3 */
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

  async function init() {
    try {
      const [leagueTrends, scoringMix, teamScatter] = await Promise.all([
        fetch("data/league_trends.json").then((res) => res.json()),
        fetch("data/scoring_mix.json").then((res) => res.json()),
        fetch("data/team_scatter.json").then((res) => res.json()),
      ]);

      updateHeroMetrics(leagueTrends);
      renderLeagueTrends(leagueTrends);
      renderScoringMix(scoringMix);
      renderTeamScatter(teamScatter);
    } catch (err) {
      console.error("Failed to boot dashboard", err);
    }
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

      const rows = metricData
        .filter((metric) => !activeMetric || activeMetric === metric.key)
        .map(
          (metric) =>
            `<span style="color:${metric.color}">${metric.label}:</span> ${metric.format(
              metric.accessor(datum)
            )}${metric.suffix}`
        )
        .join("<br>");

      tooltip
        .classed("show", true)
        .html(`<strong>${datum.season}</strong><br>${rows}`)
        .style("left", `${event.clientX + 15}px`)
        .style("top", `${event.clientY - 10}px`);
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
        const rows = keys
          .map(
            ({ key, label, color }) =>
              `<span style="color:${color}">${label}:</span> ${percentFmt(datum[key])}`
          )
          .join("<br>");
        tooltip
          .classed("show", true)
          .html(`<strong>${datum.season}</strong><br>${rows}`)
          .style("left", `${event.clientX + 15}px`)
          .style("top", `${event.clientY - 10}px`);
      })
      .on("pointerleave", () => tooltip.classed("show", false));
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
      return;
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
  }

  window.addEventListener("DOMContentLoaded", init);
})();
