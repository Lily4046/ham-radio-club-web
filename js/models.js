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
    { key: 'quantity', label: '数量', type: 'number', required: true, default: 1, min: 0, integer: true },
    { key: 'location', label: '存放位置', type: 'text', required: false },
    { key: 'status', label: '状态', type: 'select', options: ['在库', '借出', '维修', '报废'], required: true, default: '在库' },
    { key: 'borrower', label: '借用人', type: 'text', required: false },
    { key: 'notes', label: '备注', type: 'textarea', required: false }
  ];

  var BAND_OPTIONS = ['160m', '80m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m', '70cm', '其他'];
  var MODE_OPTIONS = ['SSB', 'CW', 'FT8', 'FT4', 'RTTY', 'AM', 'FM', '其他'];
  var CARD_STATUS_OPTIONS = ['未收到', '已收到', '已寄出', '双向确认'];
  var REPLY_OPTIONS = ['已回信', '未回信'];

  var QSL_FIELDS = [
    { key: 'callsign', label: '对方呼号', type: 'text', required: true },
    { key: 'ourCallsign', label: '本台呼号', type: 'text', required: false },
    { key: 'band', label: '波段', type: 'select', options: BAND_OPTIONS, required: false },
    { key: 'mode', label: '模式', type: 'select', options: MODE_OPTIONS, required: false },
    { key: 'date', label: '通联日期', type: 'date', required: true },
    { key: 'timeUtc', label: '时间 (UTC)', type: 'time', required: false },
    { key: 'rst', label: '信号报告', type: 'text', required: false },
    { key: 'cardStatus', label: '卡片状态', type: 'select', options: CARD_STATUS_OPTIONS, required: false, default: '未收到' },
    { key: 'replied', label: '是否回信', type: 'select', options: REPLY_OPTIONS, required: false, default: '未回信' },
    { key: 'senderName', label: '发信人', type: 'text', required: false },
    { key: 'senderAddress', label: '来信地址', type: 'textarea', required: false },
    { key: 'contact', label: '联系方式', type: 'text', required: false },
    { key: 'notes', label: '备注', type: 'textarea', required: false }
  ];

  // 公开登记：由「QSL 卡的原主人（对方台）」自己填写自己发出的卡片。
  // 回信相关的字段与 QSL 卡表用同一套口径，登记进来就能直接对上统计。
  var PUBLIC_QSL_FIELDS = [
    { key: 'callsign', label: '呼号', type: 'text', required: true },
    { key: 'senderName', label: '发信人姓名', type: 'text', required: false },
    { key: 'band', label: '波段', type: 'select', options: BAND_OPTIONS, required: false },
    { key: 'mode', label: '模式', type: 'select', options: MODE_OPTIONS, required: false },
    { key: 'date', label: '通联日期', type: 'date', required: true },
    { key: 'timeUtc', label: '时间 (UTC)', type: 'time', required: false },
    { key: 'rst', label: '信号报告', type: 'text', required: false },
    { key: 'cardStatus', label: '卡片状态', type: 'select', options: CARD_STATUS_OPTIONS, required: false, default: '已寄出' },
    { key: 'replied', label: '是否已收到我们的回信', type: 'select', options: REPLY_OPTIONS, required: false, default: '未回信' },
    { key: 'senderAddress', label: '回信地址（需要我们寄卡时填写）', type: 'textarea', required: false },
    { key: 'contact', label: '联系方式（邮箱 / 微信，可选）', type: 'text', required: false },
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
    radio: { key: 'radio', title: '电台设备', icon: '📻', fields: RADIO_FIELDS },
    // 公开登记：由没有 GitHub 权限的人（或访客）提交，单独存放在 data/qsl-public.json
    publicQsl: {
      key: 'publicQsl',
      title: 'QSL 登记',
      icon: '📝',
      fields: PUBLIC_QSL_FIELDS,
      publicSubmit: true,
      defaultSort: { key: 'date', dir: -1 }
    }
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
        return;
      }
      if (f.type === 'number' && v !== undefined && v !== null && String(v).trim() !== '') {
        var n = Number(v);
        if (!isFinite(n)) {
          errors.push(f.label + ' 必须是数字');
        } else if (f.integer && n % 1 !== 0) {
          errors.push(f.label + ' 必须是整数');
        } else if (f.min !== undefined && n < f.min) {
          errors.push(f.label + ' 不能小于 ' + f.min);
        }
      }
    });
    return errors;
  }

  // 表单值规整：按字段类型把「表单里的字符串」转成合适类型
  // （数字字段存成 number，文本去首尾空格；未声明的键原样保留，如 updatedAt）
  function normalize(ck, raw) {
    var model = MODELS[ck];
    var out = {};
    model.fields.forEach(function (f) {
      if (!Object.prototype.hasOwnProperty.call(raw, f.key)) return;
      var v = raw[f.key];
      if (typeof v === 'string') v = v.trim();
      if (f.type === 'number') {
        out[f.key] = (v === '' || v === undefined || v === null) ? '' : Number(v);
      } else {
        out[f.key] = (v === undefined || v === null) ? '' : v;
      }
    });
    Object.keys(raw).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = raw[k];
    });
    return out;
  }

  // 公开登记 → QSL 卡：字段映射 + 溯源信息。
  // sourceId 记录来源登记 id，用于判断「是否已并入」，避免重复导入。
  function toQslFromPublic(pub, login) {
    var rec = newItem('qsl');
    ['callsign', 'ourCallsign', 'band', 'mode', 'date', 'timeUtc', 'rst'].forEach(function (k) {
      if (pub[k] !== undefined && pub[k] !== null) rec[k] = pub[k];
    });
    // 卡片状态与回信情况由登记人填写，和 QSL 卡表同一套口径，直接沿用
    rec.cardStatus = pub.cardStatus || '未收到';
    rec.replied = pub.replied || '未回信';
    rec.senderName = pub.senderName || pub.submitter || '';
    rec.senderAddress = pub.senderAddress || '';
    rec.contact = pub.contact || '';
    var who = pub.submitter || pub.senderName || pub.callsign || '—';
    var trace = '公开登记：' + who + ' 于 ' + (pub.submittedAt || '—') + ' 提交';
    rec.notes = pub.notes ? (pub.notes + '（' + trace + '）') : trace;
    rec.sourceId = pub.id;
    rec.importedAt = new Date().toISOString();
    rec.importedBy = login || '';
    rec.updatedAt = rec.importedAt;
    rec.updatedBy = login || '公开登记并入';
    return rec;
  }

  HAM.Models = {
    MODELS: MODELS,
    genId: genId,
    newItem: newItem,
    normalize: normalize,
    toQslFromPublic: toQslFromPublic,
    validate: validate
  };
})();
