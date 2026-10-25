#!/usr/bin/env node
/**
 * 历年真题导入：从 PDF 提取文本 → 解析题目/答案 → 生成 data/raw/real_*.json。
 *
 * 用法：node scripts/import-real.mjs <pdf 文件> <paperId> <显示标题> [blank|inline]
 * 例：  node scripts/import-real.mjs /path/2022年11月....pdf 2022下 "2022年下半年 软件设计师 上午试卷（真题）" blank
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseBlankPaper, parseInlinePaper } from './real/parse.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data', 'raw');

/** 人工修正：自动解析失败的题目（上标、下标、特殊排版）。 */
const CORRECTIONS = {
  '2022下': {
    59: {
      options: ['n × e', 'n²', 'n + e', '(n + e)²'],
      stem: '若无向图 G 有 n 个顶点 e 条边，则 G 采用邻接矩阵存储时，矩阵的大小为（59）。',
    },
  },
};

const TOPIC_RULES = [
  ['NET', /网络|IP 地址|TCP|UDP|协议|路由|子网|DNS|HTTP|FTP|SMTP|以太网|交换机|路由器|MAC|VLAN|防火墙|OSI|DHCP|ARP|ICMP|带宽|局域|广域|Wi-?Fi/i],
  ['DB', /数据库|SQL|关系模式|范式|E-R|ER 图|事务|索引|视图|主键|外键|函数依赖|并发|数据仓库|数据模型|元组|属性/],
  ['OS', /进程|线程|调度|信号量|PV 操作|死锁|页面|分页|分段|磁盘|文件系统|虚拟存储|缓冲区|操作系统|互斥|临界区|索引节点|块/],
  ['PL', /编译|文法|语法|词法|正规式|自动机|后缀|表达式|链接|作用域|解释|程序设计语言|静态绑定|动态绑定|栈式|中间代码/i],
  ['OO', /面向对象|UML|类图|用例|设计模式|继承|多态|封装|接口|状态图|活动图|聚合|组合|单例|工厂/],
  ['CO', /计算机|CPU|Cache|缓存|主存|指令|流水线|总线|浮点|补码|原码|存储|寄存器|中断|DMA|控制器|海明|校验|运算器|RISC|CISC/i],
  ['SEC', /安全|加密|病毒|防火墙|著作权|专利|商标|保护期|密码|签名|标准|法律|侵权|木马|攻击|入侵|证书/i],
  ['MULTI', /多媒体|音频|视频|图像|压缩|采样|分辨率|色彩|JPEG|MPEG|流媒体/i],
  ['DS_ALGO', /排序|查找|二叉树|树|图|队列|栈|哈希|链表|算法|复杂度|动态规划|贪心|递归|哈夫曼|编码|矩阵|字符串|遍历|最小生成树|最短路径|拓扑|顶点|结点|散列/i],
  ['SE', /软件工程|需求|测试|维护|模型|项目管理|进度|风险|质量|CMM|配置|文档|耦合|内聚|原型|结构化|数据流图|DFD|瀑布|敏捷|评审/i],
];

function classify(stem) {
  for (const [topic, re] of TOPIC_RULES) if (re.test(stem)) return topic;
  return 'SE';
}

async function extractText(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, useWorkerFetch: false, isEvalSupported: false }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const lines = new Map();
    for (const it of tc.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5] / 4) * 4;
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push({ x: it.transform[4], s: it.str });
    }
    for (const [, arr] of [...lines.entries()].sort((a, b) => b[0] - a[0])) {
      text += arr.sort((a, b) => a.x - b.x).map((i) => i.s).join('') + '\n';
    }
  }
  return text;
}

async function main() {
  const [pdf, paperId, title, kind = 'blank'] = process.argv.slice(2);
  if (!pdf || !paperId || !title) {
    console.error('用法：node scripts/import-real.mjs <pdf> <paperId> <title> [blank|inline]');
    process.exit(1);
  }
  const text = await extractText(pdf);
  const items = (kind === 'inline' ? parseInlinePaper(text) : parseBlankPaper(text));

  const corrections = CORRECTIONS[paperId] ?? {};
  const questions = [];
  const problems = [];
  for (const it of items) {
    const fix = corrections[it.n] ?? {};
    let options = fix.options ?? it.options;
    const stem = (fix.stem ?? it.stem).replace(/\s+\n/g, '\n').trim();
    let answer = fix.answer ?? it.answer;
    if (fix.answers) answer = fix.answers[0];
    if (!options || options.length !== 4) {
      problems.push(`${it.n}: 选项缺失`);
      continue;
    }
    if (!answer) {
      problems.push(`${it.n}: 答案缺失`);
      continue;
    }
    options = options.map((o) => o.replace(/\s+/g, ' ').trim());
    if (options.some((o) => !o)) {
      problems.push(`${it.n}: 选项为空`);
      continue;
    }
    questions.push({
      type: 'single',
      topic: classify(stem),
      knowledge: `${paperId}·第${it.n}题`,
      difficulty: 2,
      stem,
      options,
      answer: [String(answer).toUpperCase()],
      explanation: (it.explanation ?? '').trim() || null,
      score: 1,
      paper: paperId,
      seq_no: it.n,
      source: `${title}（真题·PDF 解析版）`,
    });
  }

  questions.sort((a, b) => a.seq_no - b.seq_no);
  const out = {
    paper: paperId,
    title,
    mode: 'morning',
    questions,
  };
  const outFile = path.join(OUT_DIR, `real_${paperId}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));

  const topics = {};
  for (const q of questions) topics[q.topic] = (topics[q.topic] || 0) + 1;
  console.log(`输出 ${outFile}`);
  console.log(`题目数 ${questions.length}，题号 ${questions.map((q) => q.seq_no).join(',')}`);
  console.log('模块分布', JSON.stringify(topics));
  if (problems.length) console.log('问题：\n  ' + problems.join('\n  '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
