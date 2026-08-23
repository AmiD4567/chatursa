const { getKpiData } = require('./kpi-pbi');

(async () => {
  console.time('kpi-pbi');
  try {
    const d = await getKpiData();
    console.timeEnd('kpi-pbi');
    if (d) {
      console.log('=== KPI Data ===');
      for (const [k, v] of Object.entries(d)) {
        if (v != null) {
          console.log(k + ' = ' + v.toLocaleString('ru-RU', {maximumFractionDigits: 2}));
        } else {
          console.log(k + ' = null');
        }
      }
    } else {
      console.log('No data returned');
    }
  } catch (e) {
    console.timeEnd('kpi-pbi');
    console.error('Error:', e.message);
  }
})();
