<template>
  <div class="lands-view" v-loading="loading">
    <!-- 顶部概览 -->
    <div class="lands-header" v-if="landData">
      <h3 class="section-title">土地状态</h3>
      <span class="lands-meta">共 {{ landData.unlockedCount }} 块土地 &nbsp; 更新于 {{ formatTime(landData.updatedAt) }}</span>
    </div>

    <!-- 状态统计 -->
    <div class="land-summary" v-if="landData">
      <div class="summary-item harvestable">
        <div class="summary-value">{{ landData.harvestable }}</div>
        <div class="summary-label">可收获</div>
      </div>
      <div class="summary-item growing">
        <div class="summary-value">{{ landData.growing }}</div>
        <div class="summary-label">生长中</div>
      </div>
      <div class="summary-item empty">
        <div class="summary-value">{{ landData.empty }}</div>
        <div class="summary-label">空地</div>
      </div>
      <div class="summary-item attention">
        <div class="summary-value">{{ landData.needAttention }}</div>
        <div class="summary-label">需处理</div>
      </div>
      <div class="summary-item locked">
        <div class="summary-value">{{ landData.lockedCount }}</div>
        <div class="summary-label">未解锁</div>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="toolbar" v-if="landData">
      <el-button size="small" :icon="Refresh" @click="fetchLands" :loading="loading">刷新</el-button>
      <el-button size="small" type="success" @click="handleHarvestAll" :loading="operationLoading">一键收获</el-button>
      <el-button size="small" type="primary" @click="handleFertilizeAll" :loading="operationLoading">一键施肥</el-button>
      <el-button size="small" type="info" @click="handleInspectAll" :loading="operationLoading">一键巡田</el-button>
      <el-button size="small" type="warning" @click="handleStealAll" :loading="operationLoading">一键偷菜</el-button>
    </div>

    <!-- 土地卡片网格 -->
    <div class="land-grid" v-if="landData">
      <div
        v-for="land in landData.lands"
        :key="land.id"
        class="land-card"
        :class="[land.status || 'locked', { 'has-issue': land.needWater || land.needWeed || land.needBug }]"
      >
        <div class="land-card-header">
          <span class="land-id">土地 #{{ land.id }}</span>
          <el-tag
            v-if="getSoilName(land.soilType)"
            :type="getSoilColor(land.soilType)"
            size="small"
            round
            effect="dark"
          >{{ getSoilName(land.soilType) }}</el-tag>
          <span class="land-status-text">{{ getStatusText(land) }}</span>
        </div>

        <template v-if="land.unlocked && land.status !== 'empty'">
          <div class="land-plant-name">{{ land.plantName || '-' }}</div>
          <div class="land-phase">{{ land.phaseName || '' }}</div>

          <div class="land-time" v-if="land.timeLeftSec">
            ⏰ {{ formatTimeLeft(land.timeLeftSec) }}
          </div>

          <div class="land-issues" v-if="land.needWater || land.needWeed || land.needBug">
            <el-tag v-if="land.needWater" type="primary" size="small" round>💧 需浇水</el-tag>
            <el-tag v-if="land.needWeed" type="success" size="small" round>🌱 需除草</el-tag>
            <el-tag v-if="land.needBug" type="warning" size="small" round>🐛 需除虫</el-tag>
          </div>
        </template>

        <template v-else-if="!land.unlocked">
          <div class="land-locked">🔒 未解锁</div>
        </template>

        <template v-else>
          <div class="land-empty-text">空地</div>
        </template>
      </div>
    </div>

    <div v-if="!landData && !loading" class="empty-state">
      <el-empty description="Bot 未运行或暂无土地数据">
        <el-button type="primary" @click="fetchLands">重试</el-button>
      </el-empty>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { getAccountLands, harvestAll, fertilizeAll, inspectAll, stealAll } from '../api/index.js'

const props = defineProps({ uin: String })

const loading = ref(false)
const operationLoading = ref(false)
const landData = ref(null)

async function fetchLands() {
  loading.value = true
  try {
    const res = await getAccountLands(props.uin)
    landData.value = res.data
  } catch { landData.value = null }
  finally { loading.value = false }
}

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString()
}

function formatTimeLeft(sec) {
  if (!sec || sec <= 0) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}小时${m}分钟${s}秒`
  if (m > 0) return `${m}分钟${s}秒`
  return `${s}秒`
}

function getStatusText(land) {
  if (!land.unlocked) return ''
  const map = { harvestable: '可收获', growing: '生长中', empty: '空地', dead: '已枯死' }
  return map[land.status] || ''
}

function getSoilName(type) {
  const map = { 1: '普通', 2: '红土地', 3: '黑土地', 4: '金土地' }
  return map[type] || ''
}

function getSoilColor(type) {
  const map = { 1: 'info', 2: 'danger', 3: '', 4: 'warning' }
  return map[type] || 'info'
}

async function handleHarvestAll() {
  operationLoading.value = true
  try {
    await harvestAll(props.uin)
    ElMessage.success('一键收获成功')
    await fetchLands()
  } catch (e) {
    ElMessage.error('一键收获失败: ' + e.message)
  } finally {
    operationLoading.value = false
  }
}

async function handleFertilizeAll() {
  operationLoading.value = true
  try {
    await fertilizeAll(props.uin)
    ElMessage.success('一键施肥成功')
    await fetchLands()
  } catch (e) {
    ElMessage.error('一键施肥失败: ' + e.message)
  } finally {
    operationLoading.value = false
  }
}

async function handleInspectAll() {
  operationLoading.value = true
  try {
    await inspectAll(props.uin)
    ElMessage.success('一键巡田成功')
    await fetchLands()
  } catch (e) {
    ElMessage.error('一键巡田失败: ' + e.message)
  } finally {
    operationLoading.value = false
  }
}

async function handleStealAll() {
  operationLoading.value = true
  try {
    await stealAll(props.uin)
    ElMessage.success('一键偷菜成功')
  } catch (e) {
    ElMessage.error('一键偷菜失败: ' + e.message)
  } finally {
    operationLoading.value = false
  }
}

onMounted(fetchLands)
</script>

<style scoped>
.lands-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
}

.lands-meta {
  color: var(--text-muted);
  font-size: 13px;
}

.land-summary {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.summary-item {
  flex: 1;
  min-width: 100px;
  text-align: center;
  padding: 16px;
  border-radius: 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
}

.summary-value {
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 4px;
}

.summary-label {
  font-size: 13px;
  color: var(--text-muted);
}

.summary-item.harvestable .summary-value { color: var(--color-success); }
.summary-item.growing .summary-value { color: var(--accent); }
.summary-item.empty .summary-value { color: var(--text-muted); }
.summary-item.attention .summary-value { color: var(--color-warning); }
.summary-item.locked .summary-value { color: var(--color-danger); }

.toolbar {
  margin-bottom: 12px;
}

.land-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.land-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px;
  min-height: 120px;
  box-shadow: var(--shadow);
  transition: box-shadow 0.2s;
}

.land-card.harvestable {
  border-color: var(--color-success);
  background: var(--bg-base);
}

.land-card.growing {
  border-color: var(--accent);
}

.land-card.has-issue {
  border-color: var(--color-warning);
}

.land-card.dead {
  border-color: var(--color-danger);
  opacity: 0.7;
}

.land-card.locked {
  opacity: 0.4;
}

.land-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.land-id {
  font-weight: 600;
  color: var(--accent);
  font-size: 14px;
}

.land-status-text {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: auto;
}

.land-plant-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 2px;
}

.land-phase {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.land-time {
  font-size: 13px;
  color: var(--color-warning);
  margin-bottom: 6px;
}

.land-issues {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.land-locked, .land-empty-text {
  color: var(--text-faint);
  font-size: 14px;
  padding-top: 8px;
}

.empty-state {
  padding: 60px 20px;
  text-align: center;
}

@media (max-width: 768px) {
  .land-summary {
    gap: 8px;
  }

  .summary-item {
    min-width: 80px;
    padding: 10px;
  }

  .summary-value {
    font-size: 22px;
  }

  .land-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .lands-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
}
</style>
