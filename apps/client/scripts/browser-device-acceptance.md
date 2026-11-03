# 设备模拟 + 浏览器自动化验收清单

手动或由 Goal 模式 agent 按 playbook 走通：

1. `app_browser_open` 打开目标页
2. H5：`app_browser_device` preset=`iphone-15-pro`，核对 readback.innerWidth≈393
3. `app_browser_wait` condition=`selector` / `clickable`
4. `app_browser_read` mode=`outline` → 取 selector
5. `app_browser_act` click / type / select
6. `app_browser_read` mode=`assertText` 或 `assertVisible`
7. `app_browser_screenshot` 目检
8. `app_browser_device` off=true 复原

边界（本阶段不做）：iframe、upload、swipe、非 Windows CDP。
