<template>
  <Teleport to="body">
    <div v-if="open" class="platform-modal-backdrop dashboard-settings-backdrop" @mousedown.self="$emit('close')">
      <section class="platform-modal dashboard-settings" role="dialog" aria-modal="true" aria-label="数据看板配置">
        <header class="platform-modal-head"><div><span class="platform-eyebrow">DASHBOARD LAYOUT</span><h2>看板配置</h2><p>配置保存后对所有账号生效，客户视图只读。</p></div><button type="button" class="platform-icon-btn" @click="$emit('close')" aria-label="关闭">×</button></header>
        <div class="settings-body">
          <section class="settings-section"><h3>基础设置</h3><div class="platform-form-grid settings-fields">
            <label class="wide">看板标题<input v-model.trim="draft.title" maxlength="60" required></label>
            <label>刷新周期（秒）<input v-model.number="draft.refreshSeconds" type="number" min="1" max="300" required></label>
            <label>今日任务目标<input v-model.number="draft.taskTarget" type="number" min="1" max="10000000" required></label>
            <label>完成率目标（%）<input v-model.number="draft.taskRateTarget" type="number" min="0" max="100" step="0.1" required></label>
            <label>库位占用目标（%）<input v-model.number="draft.cellTarget" type="number" min="0" max="100" step="0.1" required></label>
          </div></section>
          <section class="settings-section"><div class="settings-panels-title"><h3>面板布局</h3><span>勾选显示，使用箭头调整顺序</span></div>
            <div class="panel-config-list"><div v-for="(panel, index) in draft.panels" :key="panel.id" class="panel-config-row" :class="{ hiddenPanel: !panel.visible }">
              <label class="panel-visible"><input type="checkbox" v-model="panel.visible"><span></span></label><b>{{ panel.label }}</b><small>{{ panel.id }}</small>
              <div><button type="button" :disabled="index === 0" @click="move(index, -1)" aria-label="上移">↑</button><button type="button" :disabled="index === draft.panels.length - 1" @click="move(index, 1)" aria-label="下移">↓</button></div>
            </div></div>
          </section>
        </div>
        <div v-if="message" class="platform-message" :class="{ error: isError }">{{ message }}</div>
        <footer class="platform-modal-foot"><span v-if="dashboard.updatedAt">最近保存：{{ formatTime(dashboard.updatedAt) }} · {{ dashboard.updatedBy || '系统' }}</span><span v-else>尚未保存自定义配置</span><div><button type="button" class="platform-btn" @click="$emit('close')">取消</button><button type="button" class="platform-btn primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存并应用' }}</button></div></footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue';
import { dashboard, saveDashboardConfig } from '../store/dashboard';

const props = defineProps({ open: Boolean });
const emit = defineEmits(['close']);
const draft = ref({ panels: [] });
const saving = ref(false);
const message = ref('');
const isError = ref(false);

function cloneConfig() {
  draft.value = JSON.parse(JSON.stringify({
    id: dashboard.id, title: dashboard.title, refreshSeconds: dashboard.refreshSeconds,
    taskTarget: dashboard.taskTarget, taskRateTarget: dashboard.taskRateTarget,
    cellTarget: dashboard.cellTarget,
    panels: [...dashboard.panels].sort((a, b) => a.order - b.order)
  }));
  message.value = '';
}
function move(index, direction) {
  const target = index + direction;
  const panels = draft.value.panels;
  [panels[index], panels[target]] = [panels[target], panels[index]];
  panels.forEach((panel, i) => { panel.order = i + 1; });
}
function formatTime(value) { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
async function save() {
  if (!draft.value.title?.trim()) { message.value = '看板标题不能为空。'; isError.value = true; return; }
  if (!draft.value.panels.some(panel => panel.visible)) { message.value = '至少保留一个可见面板。'; isError.value = true; return; }
  saving.value = true; message.value = '';
  try {
    draft.value.panels.forEach((panel, index) => { panel.order = index + 1; });
    await saveDashboardConfig(draft.value);
    isError.value = false;
    emit('close');
  } catch (error) { message.value = error.message; isError.value = true; }
  finally { saving.value = false; }
}
watch(() => props.open, open => { if (open) cloneConfig(); }, { immediate: true });
</script>
