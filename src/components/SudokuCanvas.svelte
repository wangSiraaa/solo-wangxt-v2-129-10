<script lang="ts">
  import { editor } from '../lib/state.svelte';
  import { preview } from '../lib/preview.svelte';
  import { CELL_COUNT, N, colOf, rowOf, type CellIndex } from '../lib/puzzle';

  let canvas: HTMLCanvasElement;
  const CELL = 56; // CSS 像素/格
  const SIZE = CELL * N;
  let hover = $state<number | null>(null);
  let dpr = $state(1);

  // 9 个低饱和宫色
  const REGION_COLORS = [
    '#cfe3ff', '#d9f2d1', '#ffe2c2', '#f6d6d6', '#e6d8f5',
    '#c9f0ee', '#f2efcf', '#d6e4f5', '#f5d9ea'
  ];

  // 设备像素比变化时重设画布尺寸
  $effect(() => {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    canvas.style.width = SIZE + 'px';
    canvas.style.height = SIZE + 'px';
  });

  // 订阅任意会影响绘制的状态（在 draw 中读取即建立依赖）
  const tick = $derived.by(() => {
    void editor.puzzle;
    void editor.tool;
    void editor.activeThermo;
    void editor.highlightCells;
    void editor.showSolution;
    void editor.analysis;
    void editor.selectedCell;
    void preview.active;
    void preview.answers;
    void preview.selectedCell;
    void preview.verdict;
    void hover;
    void dpr;
    return 1;
  });

  $effect(() => {
    void tick;
    draw();
  });

  function center(i: CellIndex): [number, number] {
    return [colOf(i) * CELL + CELL / 2, rowOf(i) * CELL + CELL / 2];
  }

  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom 等无 2D 上下文的环境
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    if (preview.active && preview.puzzle) {
      drawPreview(ctx);
      return;
    }

    const p = editor.puzzle;
    if (!p) return;

    // 1) 宫底色
    for (let i = 0; i < CELL_COUNT; i++) {
      const r = rowOf(i), c = colOf(i);
      ctx.fillStyle = REGION_COLORS[p.regions[i] % REGION_COLORS.length];
      ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    }

    // 2) 高亮格（结构错误 / 矛盾核）
    ctx.fillStyle = 'rgba(220, 38, 38, 0.22)';
    editor.highlightCells.forEach((i) => {
      ctx.fillRect(colOf(i) * CELL, rowOf(i) * CELL, CELL, CELL);
    });

    // 悬停
    if (hover !== null) {
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      ctx.fillRect(colOf(hover) * CELL, rowOf(hover) * CELL, CELL, CELL);
    }
    // 选中格
    if (editor.selectedCell !== null) {
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 3;
      ctx.strokeRect(
        colOf(editor.selectedCell) * CELL + 1.5,
        rowOf(editor.selectedCell) * CELL + 1.5,
        CELL - 3,
        CELL - 3
      );
    }

    // 3) 温度计（先画线和泡，置于格线之下）
    p.thermometers.forEach((t, ti) => {
      const active = ti === editor.activeThermo;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // 外管
      ctx.strokeStyle = active ? '#b45309' : '#374151';
      ctx.lineWidth = CELL * 0.4;
      beginPathThrough(ctx, t.path);
      ctx.stroke();
      // 内芯
      ctx.strokeStyle = active ? '#f59e0b' : '#9ca3af';
      ctx.lineWidth = CELL * 0.26;
      beginPathThrough(ctx, t.path);
      ctx.stroke();
      // bulb（水银泡）在路径首端
      const [bx, by] = center(t.path[0]);
      ctx.fillStyle = active ? '#f59e0b' : '#374151';
      ctx.beginPath();
      ctx.arc(bx, by, CELL * 0.26, 0, Math.PI * 2);
      ctx.fill();
      // 顶端小帽
      const [tx, ty] = center(t.path[t.path.length - 1]);
      ctx.fillStyle = active ? '#f59e0b' : '#374151';
      ctx.beginPath();
      ctx.arc(tx, ty, CELL * 0.13, 0, Math.PI * 2);
      ctx.fill();
    });

    drawGrid(ctx, p);

    // 5) 提示数字（作者题面）
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${CELL * 0.62}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = '#111827';
    for (let i = 0; i < CELL_COUNT; i++) {
      const g = p.givens[i];
      if (g) {
        const [cx, cy] = center(i);
        ctx.fillText(String(g), cx, cy + 1);
      }
    }

    // 6) 解层（仅作者本地查看，不参与导出；作答模式下永不绘制）
    if (editor.showSolution && editor.analysis.result?.solution) {
      const sol = editor.analysis.result.solution;
      ctx.font = `500 ${CELL * 0.42}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = '#2563eb';
      for (let i = 0; i < CELL_COUNT; i++) {
        if (p.givens[i]) continue;
        const [cx, cy] = center(i);
        ctx.fillText(String(sol[i]), cx, cy + 1);
      }
    }
  }

  /** 作答盘绘制：提示不可改、学生填数独立配色、冲突实时标红、绝不绘制答案层 */
  function drawPreview(ctx: CanvasRenderingContext2D) {
    const p = preview.puzzle!;
    const answers = preview.answers;
    const conflictCells = preview.conflictCells;

    // 1) 宫底色
    for (let i = 0; i < CELL_COUNT; i++) {
      const r = rowOf(i), c = colOf(i);
      ctx.fillStyle = REGION_COLORS[p.regions[i] % REGION_COLORS.length];
      ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    }

    // 2) 温度计（题面的一部分；作答模式不可编辑）
    p.thermometers.forEach((t) => {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = CELL * 0.4;
      beginPathThrough(ctx, t.path);
      ctx.stroke();
      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = CELL * 0.26;
      beginPathThrough(ctx, t.path);
      ctx.stroke();
      const [bx, by] = center(t.path[0]);
      ctx.fillStyle = '#374151';
      ctx.beginPath();
      ctx.arc(bx, by, CELL * 0.26, 0, Math.PI * 2);
      ctx.fill();
      const [tx, ty] = center(t.path[t.path.length - 1]);
      ctx.beginPath();
      ctx.arc(tx, ty, CELL * 0.13, 0, Math.PI * 2);
      ctx.fill();
    });

    drawGrid(ctx, p);

    // 3) 冲突格标红（行/列/宫重复 + 温度计递增冲突）
    conflictCells.forEach((i) => {
      ctx.fillStyle = 'rgba(220, 38, 38, 0.24)';
      ctx.fillRect(colOf(i) * CELL, rowOf(i) * CELL, CELL, CELL);
    });

    // 悬停（仅可作答格给出反馈）
    if (hover !== null) {
      ctx.fillStyle = (p.givens[hover] ?? 0) !== 0 ? 'rgba(0,0,0,0.03)' : 'rgba(37,99,235,0.10)';
      ctx.fillRect(colOf(hover) * CELL, rowOf(hover) * CELL, CELL, CELL);
    }
    // 选中格
    if (preview.selectedCell !== null) {
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 3;
      ctx.strokeRect(
        colOf(preview.selectedCell) * CELL + 1.5,
        rowOf(preview.selectedCell) * CELL + 1.5,
        CELL - 3,
        CELL - 3
      );
    }

    // 4) 数字：提示为黑色粗体（题面），学生填数为蓝色
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${CELL * 0.6}px ui-sans-serif, system-ui, sans-serif`;
    for (let i = 0; i < CELL_COUNT; i++) {
      const g = p.givens[i] ?? 0;
      const v = g !== 0 ? g : answers[i] ?? 0;
      if (!v) continue;
      const [cx, cy] = center(i);
      ctx.fillStyle = g !== 0 ? '#111827' : conflictCells.has(i) ? '#b91c1c' : '#1d4ed8';
      ctx.fillText(String(v), cx, cy + 1);
    }
  }

  function drawGrid(ctx: CanvasRenderingContext2D, p: { regions: number[] }) {
    // 细格线
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;
    for (let k = 0; k <= N; k++) {
      ctx.beginPath(); ctx.moveTo(k * CELL + 0.5, 0); ctx.lineTo(k * CELL + 0.5, SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, k * CELL + 0.5); ctx.lineTo(SIZE, k * CELL + 0.5); ctx.stroke();
    }
    // 宫界（粗线）：相邻不同宫
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < CELL_COUNT; i++) {
      const r = rowOf(i), c = colOf(i);
      const x = c * CELL, y = r * CELL;
      if (r === 0 || p.regions[i] !== p.regions[i - N]) line(ctx, x, y, x + CELL, y);
      if (c === 0 || p.regions[i] !== p.regions[i - 1]) line(ctx, x, y, x, y + CELL);
      if (r === N - 1 || p.regions[i] !== p.regions[i + N]) line(ctx, x + CELL, y, x + CELL, y + CELL);
      if (c === N - 1 || p.regions[i] !== p.regions[i + 1]) line(ctx, x, y + CELL, x + CELL, y + CELL);
    }
  }

  function beginPathThrough(ctx2: CanvasRenderingContext2D, path: CellIndex[]) {
    const [sx, sy] = center(path[0]);
    ctx2.beginPath();
    ctx2.moveTo(sx, sy);
    for (let k = 1; k < path.length; k++) {
      const [x, y] = center(path[k]);
      ctx2.lineTo(x, y);
    }
  }
  function line(ctx2: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
    ctx2.beginPath();
    ctx2.moveTo(x1, y1);
    ctx2.lineTo(x2, y2);
    ctx2.stroke();
  }

  function eventCell(e: MouseEvent): CellIndex | null {
    const rect = canvas.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * N);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * N);
    if (r < 0 || r >= N || c < 0 || c >= N) return null;
    return r * N + c;
  }

  let painting = false;
  function onDown(e: MouseEvent) {
    const cell = eventCell(e);
    if (cell === null) return;
    // 作答模式：只选择作答格，绝不触碰题面
    if (preview.active) {
      preview.selectCell(cell);
      return;
    }
    painting = true;
    editor.onCellClick(cell);
  }
  function onMove(e: MouseEvent) {
    hover = eventCell(e);
    if (preview.active) return; // 作答盘无拖动刷色
    // 宫区刷色支持拖动
    if (painting && editor.tool === 'regions' && hover !== null) editor.onCellClick(hover);
  }
  function onUp() {
    painting = false;
  }
  function onLeave() {
    hover = null;
    painting = false;
  }
  function onDbl(e: MouseEvent) {
    if (preview.active) return;
    const cell = eventCell(e);
    if (cell !== null && editor.tool === 'thermo-extend') editor.finishThermo();
  }
</script>

<canvas
  bind:this={canvas}
  role="grid"
  aria-label={preview.active ? '作答盘' : '数独棋盘'}
  onpointerdown={onDown}
  onpointermove={onMove}
  onpointerup={onUp}
  onpointerleave={onLeave}
  ondblclick={onDbl}
></canvas>

<style>
  canvas {
    display: block;
    border-radius: 6px;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
    background: #fff;
    cursor: crosshair;
    max-width: 100%;
    touch-action: none;
  }
</style>
