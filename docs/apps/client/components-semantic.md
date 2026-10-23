# cogito Client 组件语义化描述

本文档包含业务通用组件的语义化（Semantic）描述信息。

> 总计 5 个组件包；Fallback / Provider 无视觉 classNames API，仅作结构说明。

---

# contextmenu-cn Semantic

Source: `apps/client/src/components/contextmenu/`

## ContextMenu

### Semantic Parts

- root（`contextmenu-root` / 触发器 classNames.root）：根层或触发区域；Portal 内壳为全屏透明层（`pointer-events: none`），面板单独接收事件
- panel（`contextmenu-panel`）：菜单面板，含背景、边框、圆角、阴影、定位（`position: fixed`）
- submenu（`classNames.submenu`）：子级面板附加 class（与 panel 同节点叠加）
- item（`contextmenu-item`）：菜单项；状态修饰：`is-active` / `is-disabled` / `is-danger` / `has-children`
- icon（`contextmenu-icon`）：左侧图标槽；无图标时为 `contextmenu-icon-empty`
- label（`contextmenu-label`）：主文案
- shortcut（`contextmenu-shortcut`）：右侧快捷键 / extra
- arrow（`contextmenu-arrow`）：子菜单箭头；无子级时为 `contextmenu-arrow-empty`
- divider（`contextmenu-divider`）：分割线
- group（`contextmenu-group`）：分组容器
- groupTitle（`contextmenu-group-title`）：分组标题

样式令牌示例：`--popover`、`--foreground`、`--radius-lg`、`--border`。

### 使用案例

```tsx
<ContextMenu
  items={items}
  classNames={{
    root: 'semantic-mark-root',
    panel: 'semantic-mark-panel',
    item: 'semantic-mark-item',
    icon: 'semantic-mark-icon',
    label: 'semantic-mark-label',
    shortcut: 'semantic-mark-shortcut',
    arrow: 'semantic-mark-arrow',
    submenu: 'semantic-mark-submenu',
    divider: 'semantic-mark-divider',
    group: 'semantic-mark-group',
    groupTitle: 'semantic-mark-group-title'
  }}
>
  <div>右键区域</div>
</ContextMenu>
```

### Abstract DOM Structure

```html
<!-- Portal 内 -->
<div class="contextmenu-root">
  <div class="contextmenu-panel is-root" role="menu" data-flip-x="false" data-flip-y="false">
    <div class="contextmenu-item" role="menuitem" data-contextmenu-key="copy">
      <span class="contextmenu-icon"><!-- icon --></span>
      <span class="contextmenu-label">复制</span>
      <span class="contextmenu-shortcut">Ctrl+C</span>
      <span class="contextmenu-arrow contextmenu-arrow-empty"></span>
    </div>
    <div class="contextmenu-divider" role="separator"></div>
    <div class="contextmenu-item has-children is-active" role="menuitem" aria-haspopup="true" aria-expanded="true" data-contextmenu-key="export">
      <span class="contextmenu-icon contextmenu-icon-empty"></span>
      <span class="contextmenu-label">导出</span>
      <span class="contextmenu-arrow"><!-- chevron --></span>
    </div>
  </div>
  <!-- 子面板同级 fixed -->
  <div class="contextmenu-panel" role="menu">
    <div class="contextmenu-item" role="menuitem" data-contextmenu-key="png">
      <span class="contextmenu-icon contextmenu-icon-empty"></span>
      <span class="contextmenu-label">PNG</span>
      <span class="contextmenu-arrow contextmenu-arrow-empty"></span>
    </div>
  </div>
</div>
```

---

# combobox-cn Semantic

Source: `apps/client/src/components/combobox/`

## Combobox

### Semantic Parts

- root（`combobox` + `classNames.root`）：根容器；展开时附加 `is-active`
- trigger（`combobox-trigger` + `classNames.trigger`）：文本输入框
- section（`combobox-section` + `classNames.section`）：下拉面板（motion 包裹）
- series（`combobox-series`）：`Combobox.Series` 列表容器（无 classNames 透传）
- fragment（`combobox-fragment`）：单个选项行

辅助结构：`combobox-composer` 包裹 prefix / trigger / suffix。

### 使用案例

```tsx
<Combobox
  visible
  classNames={{
    root: 'semantic-mark-root',
    trigger: 'semantic-mark-trigger',
    section: 'semantic-mark-section'
  }}
  section={<Combobox.Series options={options} />}
/>
```

### Abstract DOM Structure

```html
<div class="combobox is-active semantic-mark-root" style="--combobox-section-offset: 40px;">
  <div class="combobox-composer" data-region="false">
    <!-- prefix -->
    <input class="combobox-trigger semantic-mark-trigger" type="text" />
    <!-- suffix -->
  </div>
  <div class="combobox-section semantic-mark-section">
    <div class="combobox-series">
      <div class="combobox-fragment" datatype="1">
        <span>选项一</span>
      </div>
    </div>
  </div>
</div>
```

---

# glide-cn Semantic

Source: `apps/client/src/components/glide/`

## Glide

### Semantic Parts

- root（`glide` module + `classNames.root`）：外层尺寸容器
- wrapper（`xWrapper` / `yWrapper` + `classNames.wrapper`）：滚动层；`X` 为旋转后的滚动轴，`Y` 为 `overflow-y`
- inner（`xInner` / `yInner` + `classNames.inner`）：内容层；`X` 再反向旋转并横向 flex

`Glide.X` 根上注入 CSS 变量：`--glide-width`、`--glide-height`。

### 使用案例

```tsx
<Glide.X
  classNames={{
    root: 'semantic-mark-root',
    wrapper: 'semantic-mark-wrapper',
    inner: 'semantic-mark-inner'
  }}
>
  {children}
</Glide.X>
```

### Abstract DOM Structure

**Glide.X**

```html
<div class="glide semantic-mark-root" style="--glide-width: 320px; --glide-height: 120px;">
  <div class="xWrapper semantic-mark-wrapper">
    <div class="xInner semantic-mark-inner">
      <!-- children -->
    </div>
  </div>
</div>
```

**Glide.Y**

```html
<div class="glide semantic-mark-root">
  <div class="yWrapper semantic-mark-wrapper">
    <div class="yInner semantic-mark-inner">
      <!-- children -->
    </div>
  </div>
</div>
```

（实际 class 名来自 CSS Modules，上表为语义角色；运行时为哈希 class。）

---

# fallback-cn Semantic

Source: `apps/client/src/components/fallback/`

## Fallback.Route

### Semantic Parts

无 `classNames` API。固定全视口 flex 居中布局 + 设计系统 `Spinner`。

### Abstract DOM Structure

```html
<div class="flex h-screen w-screen items-center justify-center bg-transparent">
  <svg role="status" aria-label="Loading" class="size-4 animate-spin text-muted-foreground"><!-- Spinner --></svg>
</div>
```

---

# provider-cn Semantic

Source: `apps/client/src/components/provider/`

## QueryProvider

### Semantic Parts

无视觉 DOM 语义。Context 包装器，不渲染可样式化结构节点（仅透传 `children`）。

### Abstract DOM Structure

```html
<!-- QueryProvider -->
<!-- children only -->
```
