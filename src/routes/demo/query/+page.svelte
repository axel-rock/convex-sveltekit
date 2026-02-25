<script lang="ts">
  import { convexQuery, convexForm, convexCommand } from "$lib/index.js"
  import { api } from "$convex/_generated/api"
  import { z } from "zod"

  const tasks = convexQuery(api.tasks.get, {})
  const createTask = convexForm(z.object({ text: z.string().min(1) }), api.tasks.create)
  const removeTask = convexCommand(api.tasks.remove)
  const toggleTask = convexCommand(api.tasks.toggleComplete)
</script>

<div class="notice notice-blue">
  <strong>Remote query:</strong> Same API as SvelteKit's <code>query()</code> —
  <code>.current</code>, <code>.loading</code>, <code>.ready</code> — but live via WebSocket. No
  load function. <em>Data resets every 5 min.</em>
</div>

<form {...createTask} class="demo-form">
  <input {...createTask.fields.text.as("text")} placeholder="Add a task..." class="demo-input" />
  <button type="submit" disabled={!!createTask.pending} class="btn-primary btn-sm">
    {createTask.pending ? "Adding..." : "Add"}
  </button>
</form>

{#if tasks.loading}
  <div class="loading">
    <span class="spinner"></span>
    Subscribing to Convex...
  </div>
{:else if tasks.error}
  <p class="error">Error: {tasks.error.message}</p>
{:else}
  <ul class="task-list">
    {#each tasks.current ?? [] as task (task._id)}
      <li class="task-item">
        <button
          onclick={() => toggleTask({ id: task._id })}
          class="task-check"
          disabled={!!toggleTask.pending}
        >
          {task.isCompleted ? "☑" : "☐"}
        </button>
        <span class="task-text" class:completed={task.isCompleted}>{task.text}</span>
        <button
          onclick={() => removeTask({ id: task._id })}
          class="task-delete"
          disabled={!!removeTask.pending}
          aria-label="Delete task"
        >
          &times;
        </button>
      </li>
    {/each}
  </ul>
  {#if (tasks.current ?? []).length === 0}
    <p class="empty">No tasks yet. Add one above!</p>
  {/if}
{/if}

<div class="status">
  mode: <span class="mode-query">query</span> | loading={tasks.loading} | ready={tasks.ready} | items={tasks
    .current?.length ?? 0}
</div>

<style>
  .notice {
    font-size: 0.78rem;
    padding: 0.5rem 0.75rem;
    border-radius: 3px;
    margin-bottom: 1rem;
  }
  .notice :global(code) {
    font-size: 0.75rem;
    padding: 0.1em 0.3em;
    background: color-mix(in srgb, var(--query) 12%, var(--bg));
  }
  .notice-blue {
    --query: light-dark(#3b82f6, #60a5fa);
    background: color-mix(in srgb, var(--query) 8%, var(--bg));
    color: var(--query);
    border: 1px solid color-mix(in srgb, var(--query) 20%, transparent);
  }
  .demo-form {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .demo-input {
    flex: 1;
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg);
    font-size: 0.9rem;
  }
  .demo-input:focus {
    outline: 2px solid var(--query);
    outline-offset: -1px;
    border-color: transparent;
  }
  .btn-primary {
    background: var(--accent);
    color: #fff;
    padding: 0.4rem 1rem;
    border: none;
    border-radius: 3px;
    font-weight: 500;
    font-size: 0.85rem;
  }
  .btn-primary:hover {
    background: var(--accent-dim);
  }
  .btn-primary:disabled {
    opacity: 0.5;
  }
  .loading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    justify-content: center;
    padding: 2rem 0;
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .spinner {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border: 2px solid var(--border);
    border-top-color: var(--query);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .error {
    color: var(--danger);
    font-size: 0.85rem;
  }
  .task-list {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .task-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.5rem;
    border-radius: 3px;
  }
  .task-item:hover {
    background: var(--bg-soft);
  }
  .task-check {
    background: none;
    border: none;
    font-size: 1rem;
    padding: 0;
    line-height: 1;
    color: var(--text);
  }
  .task-check:disabled {
    opacity: 0.5;
  }
  .task-text {
    flex: 1;
    font-size: 0.9rem;
  }
  .task-text.completed {
    text-decoration: line-through;
    color: var(--text-muted);
  }
  .task-delete {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.1rem;
    padding: 0 0.25rem;
    line-height: 1;
  }
  .task-delete:hover {
    color: var(--danger);
  }
  .empty {
    text-align: center;
    color: var(--text-muted);
    padding: 2rem 0;
    font-size: 0.9rem;
  }
  .status {
    margin-top: 1.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg-soft);
    border-radius: 3px;
    font-size: 0.75rem;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    color: var(--text-muted);
  }
  .mode-query {
    color: var(--query);
  }
</style>
