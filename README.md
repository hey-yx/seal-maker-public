<p align="center">
  <img src="docs/assets/cover.png" alt="标准印章生成器界面：左侧参数，右侧预览，下方八张样式卡" width="100%">
</p>

# 标准印章生成器（界面版）

这是「标准印章生成器」的前端界面，展示四类中国公司印章的配置与预览流程。仓库只放页面和示例图，不含印章渲染核心、服务端接口和计费代码，clone 下来不能生成印章。

线上完整版：<https://hey-yx.com/seal/>

![页面截图](docs/assets/screenshot.png)

## 本地看页面

```bash
python3 -m http.server 8132
```

打开 <http://127.0.0.1:8132/web/>。页面是静态的，模板卡和参数可以看，点「生成印章」不会出图。

## 包含什么

- `web/index.html`、`web/styles.css`：页面与样式
- `web/assets/samples/`：八张示例章
- `web/docs/assets/`：页面引用的官方样张
- `docs/assets/`：封面与截图

不包含：

- 印章渲染核心
- 服务端与接口
- 支付、卡密、订单逻辑

## 说明

页面里的名称、地址、编码都是空表单，不预填数据。生成的 PNG 是图像，不是公安备案的合法电子印章；正式对外文件请用备案章或合规电子签章平台。

仓库未附许可证，保留所有权利。
