<script lang="ts">
  import { preview } from '../lib/preview.svelte';
  import { editor } from '../lib/state.svelte';

  const conflicts = $derived(preview.conflicts);
  const empty = $derived(preview.emptyCount);
  const v = $derived(preview.verdict);

  // 当前题稿检查结论对"提交判完整正确"是否可用（当前指纹 + unique + 有解）
  const checkUsable = $derived(
    editor.analysis.status === 'done' &&
    editor.analysis.result?.verdict === 'unique' &&
    !!editor.analysis.result?.solution &&
    preview.fingerprint !== null &&
    editor.analysis.fingerprint === preview.fingerprint
  );

  function verdictClass(kind: string | null): string {
    switch (kind) {
      case 'correct':
        return 'correct';
      case 'incorrect':
      case 'conflicts':
        return 'bad';
      case 'need-check':
      case 'structure-invalid':
        return 'warn';
      default:
        return 'muted';
    }
  }
</script>

<div class="panel">
  <div class="head">
    <h4>作答预览（学生视角）</h4>
    <button class="exit" onclick={() => preview.exit()}>退出并保存进度</button>
  </div>

  <p class="note">
    题面为只读快照：黑色粗体是提示，蓝色是你的填数。作答进度按本题指纹独立保存，
    不会改动作者题稿，也不会读取或显示答案层。
  </p>

  <div class="stats">
    <span class="stat">待填 <strong>{empty}</strong> 格</span>
    <span class="stat" class:bad={conflicts.length > 0}>
      冲突 <strong>{conflicts.length}</strong> 处
    </span>
    <span class="stat" class:ok={checkUsable} class:warn={!checkUsable}>
      {checkUsable ? '题稿已有唯一解结论，可提交判定' : '尚无可用的唯一解检查结论'}
    </span>
  </div>

  <div class="pad">
    {#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as d (d)}
      <button class="digit" onclick={() => preview.enterDigit(d)}>{d}</button>
    {/each}
    <button class="digit zero" onclick={() => preview.clearSelected()}>清空格</button>
    <button class="digit danger" onclick={() => preview.clearAll()}>清空全部</button>
  </div>

  <div class="actions">
    <button class="submit" onclick={() => preview.submit()}>提交判定</button>
  </div>

  {#if preview.message}
    <p class="msg" class:ok={v?.kind === 'correct'}>{preview.message}</p>
  {/if}

  {#if v}
    <p class="verdict {verdictClass(v.kind)}">{v.message}</p>
  {/if}

  {#if conflicts.length > 0}
    <div class="conflicts">
      <h5>即时冲突（行 / 列 / 宫 / 温度计）</h5>
      <ul>
        {#each conflicts as c, i (i)}
          <li class="{c.kind === 'THERMO_ORDER' ? 'thermo' : ''}">{c.message}</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .panel { border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px; background: #f0f7ff; width: 380px; }
  .head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  h4 { margin: 0; font-size: 14px; }
  h5 { margin: 8px 0 4px; font-size: 12px; }
  .exit { border: 1px solid #d1d5db; background: #fff; border-radius: 6px; padding: 5px 9px; font-size: 12px; cursor: pointer; }
  .note { font-size: 12px; color: #4b5563; line-height: 1.5; margin: 8px 0; }
  .stats { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .stat { font-size: 12px; background: #fff; border: 1px solid #dbe4f0; border-radius: 999px; padding: 3px 10px; color: #374151; }
  .stat.ok { border-color: #86efac; color: #166534; background: #f0fdf4; }
  .stat.warn { border-color: #fcd34d; color: #92400e; background: #fffbeb; }
  .stat.bad { border-color: #fca5a5; color: #991b1b; background: #fef2f2; }
  .pad { display: flex; flex-wrap: wrap; gap: 6px; }
  .digit { width: 34px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; padding: 6px 0; font-size: 13px; font-weight: 600; cursor: pointer; }
  .digit.zero, .digit.danger { width: auto; padding: 6px 10px; }
  .digit.danger { color: #dc2626; border-color: #fecaca; }
  .actions { margin-top: 10px; }
  .submit { background: #1d4ed8; color: #fff; border: none; border-radius: 6px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
  .msg, .verdict { font-size: 13px; margin: 10px 0 0; padding: 8px 10px; border-radius: 6px; background: #fff; border: 1px solid #e5e7eb; }
  .msg.ok { background: #dcfce7; border-color: #86efac; color: #166534; font-weight: 600; }
  .verdict.correct { background: #dcfce7; border-color: #86efac; color: #166534; font-weight: 600; }
  .verdict.bad { background: #fee2e2; border-color: #fca5a5; color: #991b1b; }
  .verdict.warn { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
  .muted { color: #4b5563; }
  .conflicts { margin-top: 10px; }
  .conflicts ul { margin: 0; padding-left: 18px; font-size: 12px; }
  .conflicts li { margin: 3px 0; color: #991b1b; }
  .conflicts li.thermo { font-weight: 600; }
</style>
