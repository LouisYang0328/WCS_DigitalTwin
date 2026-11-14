/* 看板 7 张图的配置构造器：每个函数拿到 (echarts, snapshot, size) 返回一份 option，
 * 由 DashChart 组件负责 init / resize / setOption。数据来自引擎发布的 dash.snapshot。 */

export const DC = {
  cyan: '#22d3ee', blue: '#3b82f6', teal: '#2dd4bf', green: '#34d399',
  amber: '#fbbf24', red: '#f87171', violet: '#a78bfa', sub: '#7f95b6',
  axis: 'rgba(96,130,175,.35)', split: 'rgba(96,130,175,.14)'
};

export const fmt = value => Math.round(Number(value) || 0).toLocaleString('en-US');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const TIP_BASE = {
  backgroundColor: 'rgba(5,17,33,.94)', borderColor: 'rgba(56,189,248,.4)', borderWidth: 1,
  padding: [6, 9], textStyle: { color: '#cfe3ff', fontSize: 10.5 },
  extraCssText: 'box-shadow:0 8px 22px rgba(0,0,0,.55);border-radius:5px;'
};

function tip(trigger) {
  return Object.assign({}, TIP_BASE, {
    trigger,
    axisPointer: { type: 'line', lineStyle: { color: 'rgba(56,189,248,.35)', width: 1 } }
  });
}

function axisX(data) {
  return {
    type: 'category', data, boundaryGap: true, axisTick: { show: false },
    axisLine: { lineStyle: { color: DC.axis } },
    axisLabel: { color: DC.sub, fontSize: 9, margin: 6 }
  };
}

function axisY(name) {
  return {
    type: 'value', name: name || '',
    nameTextStyle: { color: DC.sub, fontSize: 8.5, padding: [0, 12, 0, 0] },
    splitNumber: 3, axisLine: { show: false }, axisTick: { show: false },
    splitLine: { lineStyle: { color: DC.split, type: 'dashed' } },
    axisLabel: { color: DC.sub, fontSize: 8.5 }
  };
}

function legend(data) {
  return {
    top: 0, right: 0, itemWidth: 6, itemHeight: 6, itemGap: 9, icon: 'circle',
    textStyle: { color: '#9fb4d4', fontSize: 9 }, data
  };
}

/* 入场动画保留，更新瞬时生效：否则每 1.8s 一次的刷新会让标签反复淡入。 */
function animate(option) {
  option.animation = true;
  option.animationDuration = 600;
  option.animationEasing = 'cubicOut';
  option.animationDurationUpdate = 0;
  return option;
}

function gradient(echarts, from, to) {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1,
    [{ offset: 0, color: from }, { offset: 1, color: to }]);
}

export function taskTrend(echarts, snapshot) {
  if (!snapshot) return null;
  const s = snapshot;
  return animate({
    grid: { left: 2, right: 4, top: 26, bottom: 0, containLabel: true },
    legend: legend(['入库', '出库', '移库', '完成率']),
    tooltip: tip('axis'),
    xAxis: axisX(s.days),
    yAxis: [
      axisY('任务'),
      {
        type: 'value', min: 85, max: 100, splitNumber: 3, splitLine: { show: false },
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: DC.sub, fontSize: 8.5, formatter: '{value}%' }
      }
    ],
    series: [
      { name: '入库', type: 'bar', stack: 't', barWidth: '44%', data: s.taskIn,
        itemStyle: { color: gradient(echarts, '#22d3ee', '#0b4f70') } },
      { name: '出库', type: 'bar', stack: 't', data: s.taskOut,
        itemStyle: { color: gradient(echarts, '#3b82f6', '#123a6b') } },
      { name: '移库', type: 'bar', stack: 't', data: s.taskMove,
        itemStyle: { color: gradient(echarts, '#a78bfa', '#3b2a6b'), borderRadius: [2, 2, 0, 0] } },
      { name: '完成率', type: 'line', yAxisIndex: 1, data: s.taskRate, smooth: true,
        symbol: 'circle', symbolSize: 4, z: 6,
        lineStyle: { width: 1.6, color: '#fbbf24', shadowColor: 'rgba(251,191,36,.5)', shadowBlur: 8 },
        itemStyle: { color: '#fbbf24', borderColor: '#0a1a2f', borderWidth: 1 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1,
          [{ offset: 0, color: 'rgba(251,191,36,.2)' }, { offset: 1, color: 'rgba(251,191,36,0)' }]) } }
    ]
  });
}

export function taskType(echarts, snapshot) {
  if (!snapshot) return null;
  const s = snapshot;
  const items = [
    { name: '入库', value: s.taskIn[s.taskIn.length - 1], color: DC.cyan },
    { name: '出库', value: s.taskOut[s.taskOut.length - 1], color: DC.blue },
    { name: '移库', value: s.taskMove[s.taskMove.length - 1], color: DC.violet }
  ];
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  const pct = {};
  items.forEach(item => { pct[item.name] = (item.value / total * 100).toFixed(1); });
  return animate({
    tooltip: tip('item'),
    legend: {
      orient: 'vertical', right: 0, top: 'center', itemWidth: 6, itemHeight: 6,
      itemGap: 13, icon: 'circle', textStyle: { color: '#9fb4d4', fontSize: 9.5 },
      formatter: name => name + '  ' + pct[name] + '%'
    },
    title: {
      text: fmt(total), subtext: '今日任务', left: '33%', top: '39%', textAlign: 'center', itemGap: 2,
      textStyle: { color: '#eaf6ff', fontSize: 16, fontWeight: 700 },
      subtextStyle: { color: '#7590b3', fontSize: 9 }
    },
    series: [{
      type: 'pie', radius: ['55%', '77%'], center: ['33%', '52%'], startAngle: 100,
      avoidLabelOverlap: false, label: { show: false }, labelLine: { show: false },
      itemStyle: { borderColor: 'rgba(6,20,38,.9)', borderWidth: 2 },
      emphasis: { scale: true, scaleSize: 3, itemStyle: { shadowBlur: 16, shadowColor: 'rgba(34,211,238,.5)' } },
      data: items.map(item => ({
        name: item.name, value: item.value,
        itemStyle: { color: item.color, shadowBlur: 10, shadowColor: item.color }
      }))
    }]
  });
}

/* 热力图字号跟着容器宽度走，所以这里要拿到 size。 */
export function cellHeat(echarts, snapshot, size) {
  if (!snapshot) return null;
  const s = snapshot;
  const width = size && size.width ? size.width : 480;
  const labelFs = Math.round(clamp(width / 62, 10, 14));
  const axisFs = Math.round(clamp(width / 80, 9.5, 12));
  const data = s.heat.map(h => [h.aisle, h.level - 1, Number(h.pct.toFixed(1)), h.occ, h.n]);
  const levels = s.heat.reduce((max, h) => Math.max(max, h.level), 0);
  const labels = [];
  for (let i = 1; i <= levels; i++) labels.push('L' + i);
  return animate({
    tooltip: Object.assign({}, TIP_BASE, {
      trigger: 'item',
      formatter: item => '巷道 A0' + (item.value[0] + 1) + ' · 货架 ' + (item.value[1] + 1) + ' 层<br>' +
        '占用 <b>' + item.value[3] + '</b> / ' + item.value[4] + ' 库位<br>占用率 ' + item.value[2] + '%'
    }),
    grid: { left: 2, right: 8, top: 6, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category', data: ['A01', 'A02', 'A03', 'A04', 'A05'],
      axisTick: { show: false }, axisLine: { lineStyle: { color: DC.axis } },
      axisLabel: { color: '#9fbce0', fontSize: axisFs, margin: 6 }
    },
    yAxis: {
      type: 'category', data: labels,
      axisTick: { show: false }, axisLine: { show: false },
      axisLabel: { color: '#9fbce0', fontSize: axisFs }
    },
    visualMap: {
      min: 30, max: 85, dimension: 2, show: false,
      inRange: { color: ['#08182b', '#0b3a56', '#0f7c9b', '#28c9e8', '#9df3ff'] }
    },
    series: [{
      type: 'heatmap', data,
      label: {
        show: true, formatter: item => item.value[2] + '%',
        color: '#f2fbff', fontSize: labelFs, fontWeight: 600,
        textBorderColor: 'rgba(2,10,20,.9)', textBorderWidth: 2
      },
      itemStyle: { borderColor: 'rgba(4,12,24,.95)', borderWidth: 4, borderRadius: 3 },
      emphasis: {
        itemStyle: { borderColor: '#e0f7ff', borderWidth: 1, shadowBlur: 12, shadowColor: 'rgba(34,211,238,.6)' }
      }
    }]
  });
}

export function deviceState(echarts, snapshot) {
  if (!snapshot) return null;
  const s = snapshot;
  const items = [
    { name: '运行', value: s.dev.run, color: DC.cyan },
    { name: '任务中', value: s.dev.work, color: DC.green },
    { name: '报警', value: s.dev.alarm, color: DC.red }
  ];
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const value = {};
  items.forEach(item => { value[item.name] = item.value; });
  return animate({
    tooltip: tip('item'),
    title: {
      text: fmt(total), subtext: '设备总数', left: '33%', top: '39%', textAlign: 'center', itemGap: 2,
      textStyle: { color: '#eaf6ff', fontSize: 16, fontWeight: 700 },
      subtextStyle: { color: '#7590b3', fontSize: 9 }
    },
    legend: {
      orient: 'vertical', right: 0, top: 'center', itemWidth: 6, itemHeight: 6,
      itemGap: 12, icon: 'circle', textStyle: { color: '#9fb4d4', fontSize: 9 },
      formatter: name => name + ' ' + value[name]
    },
    series: [{
      type: 'pie', radius: ['56%', '78%'], center: ['33%', '52%'],
      label: { show: false }, labelLine: { show: false },
      itemStyle: { borderColor: 'rgba(6,20,38,.9)', borderWidth: 2 },
      emphasis: { scale: true, scaleSize: 3 },
      data: items.map(item => ({ name: item.name, value: item.value, itemStyle: { color: item.color } }))
    }]
  });
}

export function cellAisle(echarts, snapshot) {
  if (!snapshot) return null;
  const s = snapshot;
  const reversed = s.aisle.slice().reverse();
  return animate({
    grid: { left: 2, right: 32, top: 4, bottom: 0, containLabel: true },
    tooltip: Object.assign({}, TIP_BASE, {
      trigger: 'item',
      formatter: item => {
        const aisle = s.aisle.find(entry => entry.name === item.name);
        return '巷道 ' + item.name + '<br>占用率 <b>' + item.value.toFixed(1) + '%</b><br>' +
          aisle.occ + ' / ' + aisle.n + ' 库位';
      }
    }),
    xAxis: { type: 'value', max: 100, show: false },
    yAxis: {
      type: 'category', data: reversed.map(entry => entry.name),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#8fa8c9', fontSize: 9.5 }
    },
    series: [{
      type: 'bar', barWidth: 7, showBackground: true,
      backgroundStyle: { color: 'rgba(56,120,180,.14)', borderRadius: 4 },
      itemStyle: {
        borderRadius: 4,
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0,
          [{ offset: 0, color: '#0e7490' }, { offset: 1, color: '#5eead4' }])
      },
      label: {
        show: true, position: 'right', distance: 4,
        formatter: item => item.value.toFixed(1) + '%',
        color: '#9fe8ff', fontSize: 9
      },
      data: reversed.map(entry => Number(entry.pct.toFixed(1)))
    }]
  });
}

export function alarmRing(echarts, snapshot) {
  if (!snapshot) return null;
  const s = snapshot;
  return animate({
    series: [{
      type: 'gauge', startAngle: 90, endAngle: -270, radius: '92%', center: ['50%', '50%'],
      min: 0, max: 100,
      progress: {
        show: true, width: 8, roundCap: false,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 1,
            [{ offset: 0, color: '#22d3ee' }, { offset: 1, color: '#2dd4bf' }])
        }
      },
      axisLine: { lineStyle: { width: 8, color: [[1, 'rgba(56,120,180,.18)']] } },
      pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { show: false }, anchor: { show: false },
      title: { offsetCenter: [0, '32%'], color: '#7f95b6', fontSize: 9 },
      detail: {
        offsetCenter: [0, '-2%'], valueAnimation: true,
        formatter: value => value.toFixed(1) + '%',
        color: '#eaf6ff', fontSize: 18, fontWeight: 700
      },
      data: [{ value: s.alarm.rate, name: '报警处理率' }]
    }]
  });
}

export function alarmTrend(echarts, snapshot) {
  if (!snapshot) return null;
  const s = snapshot;
  return animate({
    grid: { left: 0, right: 2, top: 22, bottom: 0, containLabel: true },
    legend: legend(['严重', '警告', '提示']),
    tooltip: tip('axis'),
    xAxis: axisX(s.days),
    yAxis: axisY(''),
    series: [
      { name: '严重', type: 'bar', stack: 'a', barWidth: '46%', data: s.alarmTrend.critical, itemStyle: { color: DC.red } },
      { name: '警告', type: 'bar', stack: 'a', data: s.alarmTrend.warning, itemStyle: { color: DC.amber } },
      { name: '提示', type: 'bar', stack: 'a', data: s.alarmTrend.info,
        itemStyle: { color: '#38bdf8', borderRadius: [2, 2, 0, 0] } }
    ]
  });
}
