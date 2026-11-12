# prototype-safe-merge

一个零依赖的 JavaScript 配置合并库，用于把**可信的默认配置**与**不可信的用户配置**安全地合并。
仅使用 Node.js 内置能力与 `node:test`，不引入任何第三方包，也不依赖 `JSON.stringify` 预检或
“先整体序列化再处理”之类的绕过手段。所有安全检查都在显式遍历过程中完成。

## 安装与运行

```bash
npm test          # 运行 node:test 测试套件（含独立子进程污染验证）
```

```js
import { safeMerge, MergeError, ERROR_CODES } from './lib/index.js';

const result = safeMerge(defaults, userConfig);

// 自定义资源限制
const strict = safeMerge(defaults, userConfig, {
  limits: { maxDepth: 20, maxProperties: 200 }
});
```

## 合并语义

合并在任意层级对同一属性按下面的规则处理。**属性是否存在一律以
`Reflect.ownKeys` + `Object.getOwnPropertyDescriptor` 判断，绝不使用真假值（truthy/falsy）代替。**

- **对象 + 对象**：递归合并。输出属性顺序为“默认配置的键在前，用户新增的键在后”。
- **数组 + 数组**：整体替换，不做按下标合并，用户数组被深拷贝后使用。
- **类型冲突**（对象 vs 数组、容器 vs 基本值、`null` vs 对象等）：**用户值生效**，并深拷贝。
- **基本值 / `null`**：用户值直接替换默认值。
- **`null`、`false`、`0`、`''`**：都是合法值，正常覆盖默认值，不会被当成“缺失”。
- **属性不存在**：
  - 用户缺少该键 → 保留默认值（深拷贝）。
  - 默认缺少该键 → 输出用户提供的值（深拷贝）。
  - 显式的 `undefined` 不是合法 JSON 值，遇到即报错，而不是当作“未提供”。
- **结果独立**：返回全新构建的对象/数组，与两个输入不共享任何容器引用；输入永不被修改。

## 支持的输入范围

- JSON 基本值：`string`、有限 `number`、`boolean`、`null`。
- 普通对象：原型为 `Object.prototype` 或 `null`（`Object.create(null)`）的对象。
- 密集数组（每个下标都有自身属性，不允许空洞）。

以下情况会抛出 `MergeError`（带 `code` 与属性路径 `pathString`）：

| 情况 | code |
| --- | --- |
| 任意层级出现 `__proto__`、`constructor`、`prototype` 键 | `DANGEROUS_KEY` |
| 访问器属性（getter/setter，含自身定义的） | `ACCESSOR_PROPERTY` |
| 符号（Symbol）键 | `SYMBOL_KEY` |
| 函数、`bigint`、`symbol`、`undefined`、`NaN`/`Infinity` | `UNSUPPORTED_TYPE` |
| `Date`、`RegExp`、`Map`、类实例等非普通对象 | `UNSUPPORTED_TYPE` |
| 稀疏数组、数组上的非下标自有属性 | `SPARSE_ARRAY` / `ARRAY_NON_INDEX_KEY` |
| 循环引用 | `CIRCULAR_REFERENCE` |
| 超出任一资源限制 | `MAX_*` |

## 原型污染与危险属性防护

- **危险键拒绝**：遍历时对每个字符串键做精确匹配，`__proto__`、`constructor`、`prototype`
  在任意深度（包括数组元素内部）都直接拒绝，并在错误中给出完整路径，例如 `a.b[0].__proto__`。
  默认配置与用户配置都会检查。
- **只看自身数据属性**：使用 `Reflect.ownKeys` 枚举，再用
  `Object.getOwnPropertyDescriptor` 读取描述符。不沿原型链取值，不使用 `for...in`、
  `key in obj` 或 `obj[key]` 读取，因此**不会触发任何 getter/setter**。
- **无赋值污染面**：输出通过 `Object.defineProperty` 以数据属性写入，且危险键已被拦截，
  不存在通过 `__proto__` 写入回原型的路径。
- **访问器即拒绝**：描述符不含 `value`（存在 `get`/`set`）立即报错，绝不调用它。
- **符号键拒绝**：`Reflect.ownKeys` 能发现符号键，发现即报错。
- **失败原子性**：任何一步抛错都不会写入输入，也不会改动 `Object.prototype` /
  `Array.prototype`。测试会对输入描述符与全局原型描述符做前后快照对比。

## 共享引用与循环引用

遍历过程中维护两张表：

- `seen`（`WeakMap`）：已**成功处理完**的容器 → 其输出副本。
- `active`（`WeakSet`）：当前遍历分支上**正在处理**的容器。

处理规则：

- **共享引用（非循环）**：同一容器在输入中出现多次时只克隆一次，输出中保持共享结构
  （`result.a === result.b.c`），但副本与原对象不是同一引用。
- **循环引用**：再次遇到当前分支上尚未处理完的容器时，抛出 `CIRCULAR_REFERENCE`
  并给出回到循环点的路径。循环结构无法安全表示为无环的纯 JSON 数据，因此选择拒绝而非截断。

## 资源限制（遍历中检查，不先整体复制）

默认值可通过 `options.limits` 覆盖，所有限制必须是正整数，否则抛 `INVALID_LIMIT`。

| 限制 | 默认值 | 检查时机 |
| --- | --- | --- |
| `maxDepth` | `100` | 每进入一个容器前递增深度，超限即停 |
| `maxProperties` | `1000` | 每个对象合并前统计双方自有键数量 |
| `maxArrayLength` | `10000` | 处理数组前检查 `length` |
| `maxStringLength` | `10000` | 读取每个字符串时检查其长度 |
| `maxTotalStringLength` | `200000` | 字符串长度在遍历中累计，超限立即中断 |

深度、字符串总量等都在递归下降过程中实时判定，因此一个深层或超长输入在到达限制点时即被拒绝，
不会先被完整克隆到内存中。

## Proxy 与 exotic 对象的输入边界

本库**不承诺对任意 JavaScript 对象都能无副作用地检查**。安全保证建立在普通对象/数组的
自有属性描述符语义之上：

- `Object.getPrototypeOf`、`Reflect.ownKeys`、`Object.getOwnPropertyDescriptor`
  对 `Proxy` 都会进入对应的 trap。若 trap 有副作用、谎报键或描述符，库无法从外部区分。
- 对原型不是 `Object.prototype`/`null` 的对象（含 Proxy 包装后的异类对象）一律按
  `UNSUPPORTED_TYPE` 拒绝；trap 抛错时异常会原样向上传播。
- 建议在信任边界处先 `JSON.parse(JSON.stringify(input))` 得到普通 JSON 数据再传入，
  但这是**调用方的输入归一化手段，不是本库内部的安全机制**——本库自身不做序列化预检。

## 测试策略

测试位于 `tests/`，全部基于 `node:test` 与 `node:assert`：

- `merge-semantics.test.js`：递归合并、数组替换、类型冲突、`null`/`false`/`0`/`''`、
  缺失键、空原型对象、继承属性、非枚举属性、输入不可变、结果独立。
- `security.test.js`：`JSON.parse` 危险键、嵌套与数组内危险键、访问器、符号键、
  不支持类型、稀疏数组、Proxy 边界，并对 `Object.prototype`/`Array.prototype` 做描述符快照校验。
- `references-and-limits.test.js`：共享引用、循环引用（对象/数组/交叉循环）、
  全部五项资源限制、非法限制值、失败后输入不变。
- `pollution-subprocess.test.js`：用 `tests/fixtures/unsafe-merge.js` 中**故意不安全**的
  参考实现（`for...in` + 直接下标赋值）在**独立子进程**中运行污染载荷，先证明
  `__proto__` 与 `constructor.prototype` 样例确实能污染子进程原型，再验证安全实现拒绝同样输入。
  子进程与主测试运行器隔离，污染不会泄漏到其他用例。

最近一次本地运行：`61` 个测试全部通过（`npm test`）。

## 已知限制

- 输出统一为原型 `Object.prototype` 的普通对象与普通数组（不保留输入的 `null` 原型、
  属性不可枚举性等描述符特征），因为目标场景是 JSON 配置。
- 不支持循环引用输出、异类对象、访问器与符号键——这些都以显式报错代替静默忽略。
- 无法从外部约束 Proxy trap 的行为，Proxy 不属于受支持的输入边界。
- 不提供命令行工具、网页或容器化部署。
