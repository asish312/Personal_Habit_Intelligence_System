/** PHIS_Dashboard_v1.0.0.gs — Google Sheets dashboard and chart rendering. Apps Script files share one global scope. */

function refreshPHISDashboard(asOfDate,stats,habitStats) {
  const ss=phisSpreadsheet_();
  const dash=ss.getSheetByName(PHIS.SHEETS.DASHBOARD) || ss.insertSheet(PHIS.SHEETS.DASHBOARD);
  dash.getCharts().forEach(function(chart){dash.removeChart(chart);});
  dash.getRange(1,1,dash.getMaxRows(),dash.getMaxColumns()).breakApart();
  dash.clear();
  const raw=phisReadObjects_(PHIS.SHEETS.RAW).sort(function(a,b){
    return phisNormalizeDate_(a.date).localeCompare(phisNormalizeDate_(b.date));
  });
  if (!raw.length) {
    dash.getRange("A1").setValue("Personal Habit Intelligence System");
    dash.getRange("A2").setValue("No daily data yet. Submit a capture to begin.");
    return {ok:true,empty:true,charts:0};
  }
  const latest=phisNormalizeDate_(asOfDate || raw[raw.length-1].date);
  const analytics=stats || computeAnalytics(latest);
  const habitData=habitStats || computeHabitAnalytics(latest);
  dash.setHiddenGridlines(true);
  dash.getRange("A1:I1").merge().setValue("PERSONAL HABIT INTELLIGENCE SYSTEM");
  dash.getRange("A2:I2").merge().setValue("Behaviour, consistency and recovery — as of "+latest);
  dash.getRange("A1:I1").setBackground("#14213D").setFontColor("#FFFFFF").setFontSize(16).setFontWeight("bold");
  dash.getRange("A2:I2").setBackground("#EAF0F8").setFontColor("#334155").setFontSize(10);

  const labels=["Daily completion","Current streak","7-day avg sleep","7-day avg steps"];
  const values=[
    analytics.completion_rate==="" ? "—" : analytics.completion_rate,
    analytics.current_streak,
    analytics.rolling_averages.sleep_hours==="" ? "—" : analytics.rolling_averages.sleep_hours,
    analytics.rolling_averages.steps==="" ? "—" : analytics.rolling_averages.steps
  ];
  const ranges=[["A4:B4","A5:B6"],["C4:D4","C5:D6"],["E4:F4","E5:F6"],["G4:H4","G5:H6"]];
  ranges.forEach(function(r,i){
    dash.getRange(r[0]).merge().setValue(labels[i]).setBackground("#E9EFF7").setFontColor("#475569").setFontWeight("bold");
    dash.getRange(r[1]).merge().setValue(values[i]).setBackground("#F8FAFC").setFontColor("#0F172A").setFontSize(18).setFontWeight("bold");
  });
  dash.getRange("A5:B6").setNumberFormat("0.0%");
  dash.getRange("E5:F6").setNumberFormat("0.0");
  dash.getRange("G5:H6").setNumberFormat("#,##0");

  dash.getRange("A8:I8").merge().setValue("PER-HABIT ADHERENCE");
  dash.getRange("A8:I8").setBackground("#14213D").setFontColor("#FFFFFF").setFontWeight("bold");
  let habitTableCount=0;
  if (habitData.habits.length) {
    const top=habitData.habits.slice().sort(function(a,b){
      const av=a.adherence_rate==="" ? -1 : a.adherence_rate;
      const bv=b.adherence_rate==="" ? -1 : b.adherence_rate;
      return bv-av;
    }).slice(0,12);
    dash.getRange(9,1,1,9).setValues([[
      "Habit","Adherence","Current streak","Longest streak","Done","Partial","Skipped","Missed","Not reported"
    ]]);
    dash.getRange(10,1,top.length,9).setValues(top.map(function(h){
      return [
        h.habit_name,h.adherence_rate,h.current_streak,h.longest_streak,
        h.done_days,h.partial_days,h.skipped_days,h.missed_days,h.not_reported_days
      ];
    }));
    dash.getRange(9,1,1,9).setFontWeight("bold").setBackground("#E9EFF7");
    dash.getRange(10,2,top.length,1).setNumberFormat("0.0%");
    habitTableCount=top.length;
  } else {
    dash.getRange("A9").setValue("Add habits to HABIT_MASTER and send per-habit status events to activate this view.");
  }

  dash.getRange("A19:I19").merge().setValue("SEVEN-CALENDAR-DAY TRENDS AND WEEK-OVER-WEEK CHANGE");
  dash.getRange("A19:I19").setBackground("#14213D").setFontColor("#FFFFFF").setFontWeight("bold");
  dash.getRange(20,1,1,4).setValues([["Metric","7-day average","Change vs prior 7 days","Interpretation"]]);
  const metricRows=[
    ["Sleep (hours)",analytics.rolling_averages.sleep_hours,analytics.week_over_week_change.sleep_hours],
    ["Steps",analytics.rolling_averages.steps,analytics.week_over_week_change.steps],
    ["Screen time (minutes)",analytics.rolling_averages.screen_min,analytics.week_over_week_change.screen_min],
    ["Discipline (self-rating)",analytics.rolling_averages.discipline,analytics.week_over_week_change.discipline]
  ];
  dash.getRange(21,1,metricRows.length,4).setValues(metricRows.map(function(r){
    const change=r[2];
    const text=change==="" ? "Insufficient history" : (change>0 ? "Higher than prior period" : (change<0 ? "Lower than prior period" : "No change"));
    return [r[0],r[1]==="" ? "—" : r[1],change==="" ? "—" : change,text];
  }));
  dash.getRange("A20:D20").setFontWeight("bold").setBackground("#E9EFF7");
  dash.getRange("B21:C24").setNumberFormat("0.00");

  dash.getRange("A26:I26").merge().setValue("STRONGEST SUPPORTED ASSOCIATION");
  dash.getRange("A26:I26").setBackground("#14213D").setFontColor("#FFFFFF").setFontWeight("bold");
  const strongest=analytics.strongest_correlation;
  const associationText=strongest ?
    strongest.input+" vs "+strongest.outcome+" | Pearson r = "+strongest.r.toFixed(2)+
      " | n = "+strongest.n+" | descriptive association, not proof of causation" :
    "No candidate association meets the configured minimum sample size. Continue collecting consistent data.";
  dash.getRange("A27:I28").merge().setValue(associationText)
    .setWrap(true).setBackground("#F8FAFC").setFontColor("#334155");

  const analyticsSheet=ss.getSheetByName(PHIS.SHEETS.ANALYTICS);
  const lastA=analyticsSheet.getLastRow();
  function addTrendChart_(title,seriesColumn,row,column,percent) {
    const builder=dash.newChart().asLineChart()
      .addRange(analyticsSheet.getRange(1,1,lastA,1))
      .addRange(analyticsSheet.getRange(1,seriesColumn,lastA,1))
      .setNumHeaders(1).setPosition(row,column,0,0)
      .setOption("title",title)
      .setOption("legend",{position:"none"});
    if (percent) builder.setOption("vAxis",{viewWindow:{min:0,max:1},format:"0%"});
    dash.insertChart(builder.build());
  }
  let charts=0;
  if (lastA>=2) {
    addTrendChart_("Daily habit completion rate",2,32,1,true); charts++;
    addTrendChart_("7-day average sleep (hours)",5,32,10,false); charts++;
    addTrendChart_("7-day average steps",6,50,1,false); charts++;
    addTrendChart_("7-day average screen time (minutes)",7,50,10,false); charts++;
    addTrendChart_("7-day average discipline (self-rating)",8,68,1,false); charts++;
  }
  if (habitTableCount>0) {
    const habitChart=dash.newChart().asColumnChart()
      .addRange(dash.getRange(9,1,habitTableCount+1,2))
      .setNumHeaders(1).setPosition(68,10,0,0)
      .setOption("title","Per-habit adherence")
      .setOption("vAxis",{viewWindow:{min:0,max:1},format:"0%"})
      .setOption("legend",{position:"none"})
      .build();
    dash.insertChart(habitChart);
    charts++;
  }
  dash.setColumnWidths(1,18,125);
  dash.setFrozenRows(2);
  return {ok:true,date:latest,habit_count:habitData.habits.length,charts:charts};
}
