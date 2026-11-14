<template>
  <Teleport to="body">
    <div v-if="open" class="platform-modal-backdrop" @mousedown.self="$emit('close')">
      <section class="platform-modal users-modal" role="dialog" aria-modal="true" aria-label="用户与权限管理">
        <header class="platform-modal-head"><div><span class="platform-eyebrow">ACCESS CONTROL</span><h2>用户与权限</h2><p>客户只看业务视图，工程师维护采集配置，超级管理员管理账号。</p></div><button type="button" class="platform-icon-btn" @click="$emit('close')" aria-label="关闭">×</button></header>
        <div class="role-cards">
          <div><i class="role-dot viewer"></i><span><b>客户视图</b><small>整体视图、数据看板</small></span><em>viewer</em></div>
          <div><i class="role-dot engineer"></i><span><b>运维工程师</b><small>协议连接、模拟器、看板配置</small></span><em>engineer</em></div>
          <div><i class="role-dot admin"></i><span><b>超级管理员</b><small>全部功能与用户管理</small></span><em>super_admin</em></div>
        </div>
        <div class="users-toolbar"><h3>账号列表 <span>{{ users.length }}</span></h3><button type="button" class="platform-btn primary" @click="creating = !creating">{{ creating ? '收起' : '+ 新建账号' }}</button></div>
        <form v-if="creating" class="create-user" @submit.prevent="createUser">
          <div class="platform-form-grid">
            <label>用户名<input v-model.trim="form.username" required minlength="2" maxlength="32" pattern="[A-Za-z0-9._-]+" placeholder="字母、数字、._-"></label>
            <label>显示名称<input v-model.trim="form.displayName" required maxlength="40" placeholder="例如：客户 A"></label>
            <label>角色<select v-model="form.role"><option value="viewer">客户视图</option><option value="engineer">运维工程师</option><option value="super_admin">超级管理员</option></select></label>
            <label>初始密码<input v-model="form.password" type="password" required minlength="4" maxlength="128" autocomplete="new-password" placeholder="至少 4 位"></label>
          </div>
          <button class="platform-btn primary" type="submit" :disabled="busy">创建账号</button>
        </form>
        <div v-if="message" class="platform-message" :class="{ error: isError }" role="status">{{ message }}</div>
        <div class="users-table-wrap">
          <table class="users-table"><thead><tr><th>账号</th><th>角色</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead>
            <tbody><tr v-for="user in users" :key="user.id"><td><b>{{ user.displayName }}</b><small>{{ user.username }}</small></td><td><span class="role-pill" :class="user.role">{{ roleLabels[user.role] || user.role }}</span></td><td><span class="user-status" :class="{ off: !user.enabled }">{{ user.enabled ? '启用' : '停用' }}</span></td><td>{{ formatTime(user.lastLoginAt) }}</td><td><div class="user-actions"><button type="button" @click="resetPassword(user)">重置密码</button><button v-if="user.username !== 'sa'" type="button" :class="{ danger: user.enabled }" @click="toggleUser(user)">{{ user.enabled ? '停用' : '启用' }}</button><button v-if="!user.enabled && user.username !== 'sa'" type="button" class="danger" @click="deleteUser(user)">删除</button></div></td></tr>
              <tr v-if="!users.length && !loading"><td colspan="5" class="platform-empty">暂无账号</td></tr></tbody></table>
        </div>
        <footer class="platform-modal-foot"><span>密码使用 PBKDF2 加密保存；停用或重置密码后旧登录立即失效。</span><button type="button" class="platform-btn" @click="loadUsers" :disabled="loading">刷新</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { apiRequest } from '../api';
import { auth, roleLabels } from '../store/auth';

const props = defineProps({ open: Boolean });
defineEmits(['close']);
const users = ref([]);
const loading = ref(false);
const busy = ref(false);
const creating = ref(false);
const message = ref('');
const isError = ref(false);
const form = reactive({ username: '', displayName: '', password: '', role: 'viewer' });

function notify(text, error = false) { message.value = text; isError.value = error; }
function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '从未登录'; }

async function loadUsers() {
  loading.value = true;
  try { users.value = await apiRequest('/api/users'); notify(''); }
  catch (error) { notify(error.message, true); }
  finally { loading.value = false; }
}

async function createUser() {
  busy.value = true;
  try {
    await apiRequest('/api/users', { method: 'POST', body: JSON.stringify(form) });
    Object.assign(form, { username: '', displayName: '', password: '', role: 'viewer' });
    creating.value = false;
    await loadUsers();
    notify('账号创建成功。');
  } catch (error) { notify(error.message, true); }
  finally { busy.value = false; }
}

async function toggleUser(user) {
  try {
    await apiRequest(`/api/users/${encodeURIComponent(user.id)}/status`, { method: 'PUT', body: JSON.stringify({ enabled: !user.enabled }) });
    await loadUsers();
  } catch (error) { notify(error.message, true); }
}

async function deleteUser(user) {
  if (!window.confirm(`确认删除已停用账号 ${user.username}？此操作会同时清除其登录会话。`)) return;
  try {
    await apiRequest(`/api/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
    await loadUsers();
    notify(`已删除账号 ${user.username}。`);
  } catch (error) { notify(error.message, true); }
}

async function resetPassword(user) {
  const password = window.prompt(`为 ${user.username} 设置新密码（至少 4 位）：`);
  if (password === null) return;
  if (password.length < 4) { notify('密码至少 4 位。', true); return; }
  try {
    await apiRequest(`/api/users/${encodeURIComponent(user.id)}/password`, { method: 'PUT', body: JSON.stringify({ password }) });
    notify(`已重置 ${user.username} 的密码，旧会话已退出。`);
  } catch (error) { notify(error.message, true); }
}

watch(() => props.open, open => { if (open) loadUsers(); }, { immediate: true });
</script>
