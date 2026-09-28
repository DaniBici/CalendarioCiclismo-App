// Interactive hover effect for elevation profile SVG
// Shows altitude and km when hovering over the profile
// Drag to calculate slope between two points

export function setupElevationProfileHover(svgElement, hoverData) {
  if (!hoverData || !svgElement) return;

  const { width, height, ML, MT, PW, PH, BL, xMax, profile, interpolateAlt, X, Y, lang } = hoverData;
  const climbs = Array.isArray(hoverData.climbs) ? hoverData.climbs : [];

  // Create container for crosshair and tooltip
  const container = document.createElement('div');
  container.style.position = 'relative';
  container.style.display = 'inline-block';
  container.style.width = '100%';
  svgElement.parentNode.insertBefore(container, svgElement);
  container.appendChild(svgElement);

  // Create overlay for mouse/touch tracking (invisible, covers the SVG)
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.cursor = 'crosshair';
  overlay.style.zIndex = '10';
  overlay.style.touchAction = 'none';
  overlay.style.userSelect = 'none';
  overlay.style.WebkitUserSelect = 'none';
  container.appendChild(overlay);

  // Create crosshair line (vertical)
  const crosshair = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  crosshair.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  crosshair.style.position = 'absolute';
  crosshair.style.top = '0';
  crosshair.style.left = '0';
  crosshair.style.width = '100%';
  crosshair.style.height = '100%';
  crosshair.style.pointerEvents = 'none';
  crosshair.style.zIndex = '11';
  crosshair.style.overflow = 'visible';
  crosshair.style.display = 'none';
  container.appendChild(crosshair);

  // Live tooltip (during hover and drag)
  const tooltip = document.createElement('div');
  tooltip.style.position = 'absolute';
  tooltip.style.background = 'var(--bg-card)';
  tooltip.style.border = '1px solid var(--border)';
  tooltip.style.borderRadius = '6px';
  tooltip.style.padding = '8px 12px';
  tooltip.style.fontSize = '13px';
  tooltip.style.fontWeight = '500';
  tooltip.style.color = 'var(--text)';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.zIndex = '12';
  tooltip.style.display = 'none';
  tooltip.style.whiteSpace = 'nowrap';
  tooltip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
  container.appendChild(tooltip);

  // Frozen slope tooltip (persists after drag)
  const slopeTooltip = document.createElement('div');
  slopeTooltip.style.position = 'absolute';
  slopeTooltip.style.background = 'var(--bg-card)';
  slopeTooltip.style.border = '2px solid var(--accent)';
  slopeTooltip.style.borderRadius = '6px';
  slopeTooltip.style.padding = '10px 14px';
  slopeTooltip.style.fontSize = '13px';
  slopeTooltip.style.fontWeight = '600';
  slopeTooltip.style.color = 'var(--text)';
  slopeTooltip.style.zIndex = '13';
  slopeTooltip.style.display = 'none';
  slopeTooltip.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  slopeTooltip.style.lineHeight = '1.4';
  container.appendChild(slopeTooltip);

  // Slope visualization group (will be appended inside the main SVG)
  let slopeGroup = null;

  const kmUnit = lang === 'en' ? 'km' : ' km';
  let dragStart = null;
  let frozenSlope = null;
  let justFroze = false;
  let lastDragState = null;

  function getEventCoords(e) {
    if (e.touches && e.touches.length > 0) {
      return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    }
    return { clientX: e.clientX, clientY: e.clientY };
  }

  function clearSlopeGroup() {
    if (slopeGroup) slopeGroup.innerHTML = '';
  }

  function clearFrozenSlope() {
    slopeTooltip.style.display = 'none';
    clearSlopeGroup();
    frozenSlope = null;
  }

  function fmtAlt(v) {
    return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : '.');
  }

  // ── Shared logic for move (both mouse and touch) ──────────────
  function handleMove(e) {
    // If a slope is frozen and not dragging, do nothing.
    if (frozenSlope && !dragStart) return;

    const coords = getEventCoords(e);
    const containerRect = container.getBoundingClientRect();
    const svgRect = svgElement.getBoundingClientRect();
    const x = coords.clientX - svgRect.left;
    const y = coords.clientY - svgRect.top;

    const svgScale = svgRect.width / width;
    const scaledML = ML * svgScale;
    const scaledMT = MT * svgScale;
    const scaledPW = PW * svgScale;
    const scaledBL = BL * svgScale;

    // Out of plot area
    if (x < scaledML || x > scaledML + scaledPW || y < scaledMT || y > scaledBL) {
      crosshair.style.display = 'none';
      tooltip.style.display = 'none';
      return;
    }

    const normalizedX = (x - scaledML) / scaledPW;
    const km = normalizedX * xMax;

    if (km < 0 || km > xMax) {
      crosshair.style.display = 'none';
      tooltip.style.display = 'none';
      return;
    }

    if (!dragStart) {
      // ── Normal hover mode ─────────────────────────────────────
      const altitude = interpolateAlt(km);

      crosshair.innerHTML = '';
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x);
      line.setAttribute('y1', scaledMT);
      line.setAttribute('x2', x);
      line.setAttribute('y2', scaledBL);
      line.setAttribute('stroke', 'var(--accent)');
      line.setAttribute('stroke-width', '1');
      line.setAttribute('stroke-dasharray', '4,4');
      line.setAttribute('opacity', '0.6');
      crosshair.appendChild(line);
      crosshair.style.display = 'block';

      // Si el cursor cae dentro de un puerto sombreado, el tooltip muestra
      // los datos agregados del puerto en lugar del punto simple.
      const climb = climbs.find(c => km >= c.startKm && km <= c.endKm) || null;
      if (climb) {
        const gradStr = (climb.avgGradient >= 0 ? '+' : '') + climb.avgGradient.toFixed(1) + '%';
        const climbLabel = lang === 'en' ? 'Climb' : 'Puerto';
        const gainLabel  = lang === 'en' ? 'gain'  : 'desnivel';
        const headerLine = climb.name
          ? `<strong>${climb.name}</strong>`
          : `<strong>${climbLabel}</strong>`;
        tooltip.innerHTML = `${headerLine}<br>`
          + `${climb.lengthKm.toFixed(1)}${kmUnit} · <strong>${gradStr}</strong><br>`
          + `<span style="opacity:0.75">${gainLabel}: ${fmtAlt(climb.gain)} m</span>`;
        tooltip.style.whiteSpace = 'normal';
      } else {
        const tooltipText = `${km.toFixed(1)}${kmUnit} · ${fmtAlt(altitude)} m`;
        tooltip.textContent = tooltipText;
        tooltip.style.whiteSpace = 'nowrap';
      }
      tooltip.style.display = 'block';

      const tooltipWidth = tooltip.offsetWidth || 150;
      const tooltipHeight = tooltip.offsetHeight || 40;
      const margin = 12;

      let tooltipX = coords.clientX - containerRect.left + margin;
      let tooltipY = coords.clientY - containerRect.top - tooltipHeight - margin;

      if (tooltipX + tooltipWidth + margin > containerRect.width) {
        tooltipX = coords.clientX - containerRect.left - tooltipWidth - margin;
      }
      if (tooltipY < margin) {
        tooltipY = coords.clientY - containerRect.top + margin;
      }

      tooltip.style.left = Math.max(margin, Math.min(tooltipX, containerRect.width - tooltipWidth - margin)) + 'px';
      tooltip.style.top = Math.max(margin, Math.min(tooltipY, containerRect.height - tooltipHeight - margin)) + 'px';
      return;
    }

    // ── Dragging mode — calculate slope ────────────────────────
    const altEnd = interpolateAlt(km);
    const kmDiff = Math.abs(km - dragStart.km);
    const altDiff = altEnd - dragStart.alt;
    const slope = kmDiff > 0 ? (altDiff / (kmDiff * 1000)) * 100 : 0;

    if (!slopeGroup) {
      slopeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      slopeGroup.setAttribute('class', 'slope-overlay');
      svgElement.appendChild(slopeGroup);
    }
    slopeGroup.innerHTML = '';

    const x1_vb = dragStart.x / dragStart.svgScale;
    const y1_vb = Y(dragStart.alt);
    const x2_vb = x / dragStart.svgScale;
    const y2_vb = Y(altEnd);

    const slopeLineEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    slopeLineEl.setAttribute('x1', x1_vb);
    slopeLineEl.setAttribute('y1', y1_vb);
    slopeLineEl.setAttribute('x2', x2_vb);
    slopeLineEl.setAttribute('y2', y2_vb);
    slopeLineEl.setAttribute('stroke', 'var(--accent)');
    slopeLineEl.setAttribute('stroke-width', '2');
    slopeLineEl.setAttribute('opacity', '0.8');
    slopeGroup.appendChild(slopeLineEl);

    const markerStart = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    markerStart.setAttribute('cx', x1_vb);
    markerStart.setAttribute('cy', y1_vb);
    markerStart.setAttribute('r', '4');
    markerStart.setAttribute('fill', 'var(--accent)');
    slopeGroup.appendChild(markerStart);

    const markerEnd = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    markerEnd.setAttribute('cx', x2_vb);
    markerEnd.setAttribute('cy', y2_vb);
    markerEnd.setAttribute('r', '4');
    markerEnd.setAttribute('fill', 'var(--accent)');
    slopeGroup.appendChild(markerEnd);

    // Live drag tooltip
    const slopeStr = slope >= 0 ? `+${slope.toFixed(1)}%` : `${slope.toFixed(1)}%`;
    tooltip.innerHTML = `${kmDiff.toFixed(1)}${kmUnit} / ${fmtAlt(Math.abs(altDiff))} m<br><strong>${slopeStr}</strong>`;
    tooltip.style.whiteSpace = 'normal';
    tooltip.style.display = 'block';
    crosshair.style.display = 'none';

    const tooltipWidth = tooltip.offsetWidth || 160;
    const tooltipHeight = tooltip.offsetHeight || 80;
    const margin = 12;

    let tooltipX = coords.clientX - containerRect.left + margin;
    let tooltipY = coords.clientY - containerRect.top - tooltipHeight - margin;

    if (tooltipX + tooltipWidth + margin > containerRect.width) {
      tooltipX = coords.clientX - containerRect.left - tooltipWidth - margin;
    }
    if (tooltipY < margin) {
      tooltipY = coords.clientY - containerRect.top + margin;
    }

    tooltip.style.left = Math.max(margin, Math.min(tooltipX, containerRect.width - tooltipWidth - margin)) + 'px';
    tooltip.style.top = Math.max(margin, Math.min(tooltipY, containerRect.height - tooltipHeight - margin)) + 'px';

    lastDragState = { kmDiff, altDiff, slope };
  }

  overlay.addEventListener('mousemove', handleMove);
  overlay.addEventListener('touchmove', handleMove, { passive: false });

  overlay.addEventListener('mouseleave', () => {
    if (!frozenSlope) {
      crosshair.style.display = 'none';
      tooltip.style.display = 'none';
    }
  });

  // ── Drag start (both mouse and touch) ──────────────────────────
  function handleDown(e) {
    const svgRect = svgElement.getBoundingClientRect();
    const coords = getEventCoords(e);
    const x = coords.clientX - svgRect.left;
    const svgScale = svgRect.width / width;
    const scaledML = ML * svgScale;
    const scaledPW = PW * svgScale;

    if (x < scaledML || x > scaledML + scaledPW) return;

    const normalizedX = (x - scaledML) / scaledPW;
    const km = normalizedX * xMax;

    if (km < 0 || km > xMax) return;

    // Clear any frozen slope when starting a new drag
    if (frozenSlope) clearFrozenSlope();

    dragStart = {
      x,
      km,
      alt: interpolateAlt(km),
      svgScale,
      scaledML,
      scaledPW,
    };
  }

  overlay.addEventListener('mousedown', handleDown);
  overlay.addEventListener('touchstart', handleDown, { passive: false });

  // ── Drag end (freeze or cancel) – both mouse and touch ────────
  function handleUp(e) {
    if (!dragStart || !lastDragState) return;

    const { kmDiff, altDiff, slope } = lastDragState;

    // Discard simple clicks (no real drag)
    if (kmDiff < 0.1) {
      // Clear any partial drag visualization
      clearSlopeGroup();
      tooltip.style.display = 'none';
      tooltip.innerHTML = '';
      crosshair.style.display = 'none';
      dragStart = null;
      lastDragState = null;
      return;
    }

    const slopeStr = slope >= 0 ? `+${slope.toFixed(1)}%` : `${slope.toFixed(1)}%`;

    slopeTooltip.innerHTML = `${kmDiff.toFixed(1)}${kmUnit} / ${fmtAlt(Math.abs(altDiff))} m<br><strong>${slopeStr}</strong>`;
    slopeTooltip.style.display = 'block';

    const margin = 12;
    slopeTooltip.style.left = margin + 'px';
    slopeTooltip.style.top = margin + 'px';

    // Hide live tooltip and crosshair, mark as frozen
    crosshair.style.display = 'none';
    tooltip.style.display = 'none';
    tooltip.innerHTML = '';
    frozenSlope = true;
    justFroze = true;
    dragStart = null;
  }

  overlay.addEventListener('mouseup', handleUp);
  overlay.addEventListener('touchend', handleUp, { passive: false });

  // Clean up on touch cancel (e.g., system interruption)
  overlay.addEventListener('touchcancel', () => {
    clearSlopeGroup();
    tooltip.style.display = 'none';
    tooltip.innerHTML = '';
    crosshair.style.display = 'none';
    dragStart = null;
  });

  // ── Close frozen slope on ESC ─────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && frozenSlope) {
      clearFrozenSlope();
    }
  });

  // ── Close frozen slope on click ───────────────────────────────
  // Note: a click event always fires after mousedown+mouseup. We must skip
  // the click that immediately follows a drag-release; otherwise the
  // freshly-frozen slope would be cleared right away.
  overlay.addEventListener('click', () => {
    if (justFroze) {
      justFroze = false;
      return;
    }
    if (frozenSlope && !dragStart) {
      clearFrozenSlope();
    }
  });
}
