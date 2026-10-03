<script lang="ts">
  let { feedback }: { feedback: string } = $props();
  const text = $derived(feedback === 'none' ? 'no feedback' : feedback === 'summary' ? 'summary feedback' : 'live feedback');
</script>

<span class="chip {feedback === 'continuous' ? '' : 'border-model text-model'}" title="Feedback fades as you master a step: live → summary only → none">{text}</span>
