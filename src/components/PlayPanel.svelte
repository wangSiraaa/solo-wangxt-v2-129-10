<script lang="ts">
  import { editor } from '../lib/state.svelte';

  const conflicts = $derived(editor.playConflicts);
  const grade = $derived(editor.playGrade);
  const givensCount = $derived(
    editor.puzzle ? editor.puzzle.givens.filter((g) => g >= 1 && g <= 9).length : 0
  );
  const filled = $derived(editor.playEntries.filter((v) => v >= 1 && v <= 9).length);
</script>

<div class="panel">
  {#if editor.mode !== 'play'}
    <h4>作答预览（学生视角试做）</h4>
    <p class="hint">
      从当前题面生成独立的作答盘，像学生一样试做：填数、清空、
      按行/列/宫/温度计规则即时反馈。作答不会改动题面与检查结论，
      进度按题面指纹单独保存。
    </p>
    <button class="primary" onclick={() => editor.enterPlay()}>进入作答预览</button>
  {:else}
    <div class="head">
      <h4>作答预览中（学生视角）</h4>
      <button class="exit" onclick={() => editor.exitPlay()}>退出，返回编辑</button>
    </div>

    <div class="pad">
      {#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as d (d)}
        <button class="digit" onclick={() => editor.pressDigit(d)}>{d}</button>
      {/each}
      <button class="digit zero" onclick={() => editor.pressDigit(0)}>清空格</button>
      <button class="digit danger" onclick={() => editor.clearPlay()}>全部重填</button>
    </div>
    <p class="hint">
      点选空格后填数（再按同数字可撤销）；黑色提示格不可改。
      已填 {filled} / {81 - givensCount} 格。回车 = 提交作答。
    </p>

    {#if conflicts.length > 0}
      <div class="conflicts">
        <h5>冲突（行 / 列 / 宫 / 温度计即时反馈）</h5>
        <ul>
          {#each conflicts as c, i (i)}
            <li>{c.message}</li>
          {/each}
        </ul>
      </div>
    {:else}
      <p class="ok">当前填写没有行、列、宫或温度计冲突。</p>
    {/if}

    <button class="primary submit" onclick={() => editor.submitPlay()}>提交作答</button>

    {#if grade}
      {@const g = grade}
      {#if g.kind === 'needs-check'}
        <p class="warn">
          还没有针对<b>当前题面</b>的有效「唯一解」检查结论，无法判定完整正确。
          请退出作答预览，在编辑模式运行检查并得到唯一解后再提交
          （题面一旦改动，旧结论即过期，不能沿用）。
        </p>
      {:else if g.kind === 'incomplete'}
        <p class="warn">还有 {g.empty} 个空格未填，填满后才能判定完整正确。</p>
      {:else if g.kind === 'correct'}
        <p class="ok big">作答完整正确 ✓ 与唯一解一致。</p>
      {:else if g.kind === 'incorrect'}
        <p class="bad">有 {g.wrongCells.length} 格与唯一解不符（棋盘上已用红框标出）。</p>
      {/if}
    {/if}

    <p class="note">
      作答进度保存在独立的本地存储中（按题面指纹归档，题面一变即失效），
      退出不会把作答写回题面提示，也不会改动检查结论。
    </p>
  {/if}
</div>

<style>
  .panel { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; background: #f0fdf4; }
  h4 { margin: 0 0 8px; font-size: 13px; }
  h5 { margin: 8px 0 4px; font-size: 12px; }
  .head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .hint { font-size: 12px; color: #6b7280; line-height: 1.5; }
  .primary {
    background: #047857; color: #fff; border: none; border-radius: 6px;
    padding: 8px 14px; font-size: 13px; cursor: pointer;
  }
  .submit { width: 100%; margin-top: 10px; }
  .exit {
    border: 1px solid #d1d5db; background: #fff; border-radius: 6px;
    padding: 4px 10px; font-size: 12px; cursor: pointer;
  }
  .pad { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .digit {
    width: 42px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px;
    padding: 6px 0; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .digit:hover { border-color: #047857; }
  .digit.zero { width: auto; padding: 6px 10px; font-weight: 400; }
  .digit.danger { width: auto; padding: 6px 10px; font-weight: 400; border-color: #fecaca; color: #dc2626; }
  .conflicts {
    margin-top: 8px; border: 1px solid #fecaca; background: #fef2f2;
    border-radius: 6px; padding: 6px 10px;
  }
  .conflicts ul { margin: 0; padding-left: 18px; font-size: 12px; color: #991b1b; }
  .conflicts li { margin: 2px 0; }
  .ok { font-size: 12px; color: #166534; }
  .ok.big { font-size: 14px; font-weight: 600; }
  .warn { font-size: 12px; color: #92400e; line-height: 1.5; }
  .bad { font-size: 13px; color: #dc2626; }
  .note { font-size: 11px; color: #6b7280; margin: 10px 0 0; line-height: 1.5; }
</style>
