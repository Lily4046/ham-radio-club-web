/* =========================================================================
 * 数据模型定义：三类数据的字段、类型、默认值、校验
 * -------------------------------------------------------------------------
 * 每个字段：key 存储键 / label 中文名 / type 输入类型 / options 下拉选项
 *           required 是否必填 / default 默认值
 * ========================================================================= */
(function () {
  'use strict';

  window.HAM = window.HAM || {};

  var LAB_FIELDS = [
    { key: 'name', label: '物品名称', type: 'text', required: true },
    { key: 'category', label: '分类', type: 'select', options: ['元器件', '仪器仪表', '工具', '耗材', '其他'], required: false },
    { key: 'quantity', label: '数量', type: 'number', required: true, default: 1 },
    { key: 'location', label: '存放位置', type: 'text', required: false },
    { key: 'status', label: '状态', type: 'select', options: ['在库', '借出', '维修', '报废'], required: true, default: '在库' },
    { key: 'borrower', label: '借用人', type: 'text', required: false },
    { key: 'notes', label: '备注', type: 'textarea', required: false }
  ];

  var QSL_FIELDS = [
    { key: 'callsign', label: '对方呼号', type: 'text', required: true },
    { key: 'ourCallsign', label: '本台呼号', type: 'text', required: false },
    { key: 'band', label: '波段', type: 'select', options: ['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m', '70cm', '其他'], required: false },
    { key: 'mode', label: '模式', type: 'select', options: ['SSB', 'CW', 'FT8', 'FT4', 'RTTY', 'AM', 'FM', '其他'], required: false },
    { key: 'date', label: '通联日期', type: 'date', required: true },
    { key: 'timeUtc', label: '时间 (UTC)', type: 'time', required: false },
    { key: 'rst', label: '信号报告', type: 'text', required: false },
    { key: 'cardStatus', label: '卡片状态', type: 'select', options: ['未收到', '已收到', '已寄出', '双向确认'], required: false, default: '未收到' },
    { key: 'replied', label: '是否回信', type: 'select', options: ['已回信', '未回信'], required: false, default: '未回信' },
    { key: 'senderName', label: '发信人', type: 'text', required: false },
    { key: 'senderAddress', label: '来信地址', type: 'textarea', required: false },
    { key: 'notes', label: '备注', type: 'textarea', required: false }
  ];

  var RADIO_FIELDS = [
    { key: 'name', label: '设备名称', type: 'text', required: true },
    { key: 'model', label: '型号', type: 'text', required: false },
    { key: 'category', label: '设备类型', type: 'select', options: ['收发信机', '天线', '电源', '天线调谐器', '功放', '仪表', '配件', '其他'], required: false },
    { key: 'callsign', label: '使用呼号', type: 'text', required: false },
    { key: 'serial', label: '序列号', type: 'text', required: false },
    { key: 'status', label: '状态', type: 'select', options: ['正常', '维修中', '借出', '闲置', '报废'], required: true, default: '正常' },
    { key: 'location', label: '存放位置', type: 'text', required: false },
    { key: 'assignee', label: '负责人', type: 'text', required: false },
    { key: 'notes', label: '备注', type: 'textarea', required: false }
  ];

  var MODELS = {
    lab: { key: 'lab', title: '实验室物品', icon: '🧪', fields: LAB_FIELDS },
    qsl: {
      key: 'qsl',
      title: 'QSL 卡',
      icon: '📮',
      fields: QSL_FIELDS,
      dedup: {
        fields: ['callsign', 'date', 'band', 'mode'],
        label: '对方呼号 + 通联日期 + 波段 + 模式'
      },
      stats: {
        title: '回信统计',
        field: 'replied',
        positive: '已回信',
        positiveLabel: '已回信',
        negativeLabel: '未回信',
        rateLabel: '回信率'
      },
      // 默认排序：按通联日期倒序（新 → 旧）
      defaultSort: { key: 'date', dir: -1 }
    },
    radio: { key: 'radio', title: '电台设备', icon: '📻', fields: RADIO_FIELDS }
  };

  function genId() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  // 生成一条带默认值的空记录
  function newItem(ck) {
    var model = MODELS[ck];
    var item = { id: genId() };
    model.fields.forEach(function (f) {
      if (f.default !== undefined && f.default !== null) {
        item[f.key] = f.default;
      }
    });
    return item;
  }

  // 校验：返回错误信息数组，空数组表示通过
  function validate(ck, item) {
    var model = MODELS[ck];
    var errors = [];
    model.fields.forEach(function (f) {
      var v = item[f.key];
      if (f.required && (v === undefined || v === null || String(v).trim() === '')) {
        errors.push(f.label + ' 为必填项');
      }
    });
    return errors;
  }

  HAM.Models = {
    MODELS: MODELS,
    genId: genId,
    newItem: newItem,
    validate: validate
  };
})();
