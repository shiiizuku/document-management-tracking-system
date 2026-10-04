# Separate DTS redesign samples

Open [the sample index](./index.html), then open each HTML page individually. All five use the same
fictional registry records and are static visual concepts. They do not modify the application, use
vendor assets, or claim to be official implementations of the referenced systems.

| Sample | What to compare | Reference guidance |
| --- | --- | --- |
| [Apple](./apple.html) · [image](./apple.png) | Spacious title and content hierarchy, restrained sidebar, inset list | [Human Interface Guidelines: Layout](https://developer.apple.com/design/human-interface-guidelines/layout) |
| [Material Design 3](./material.html) · [image](./material.png) | Tonal page/panel/row layers, pill controls, prominent action | [Material foundations](https://m3.material.io/foundations/) |
| [Atlassian](./atlassian.html) · [image](./atlassian.png) | Dense work table, clear ownership and status, compact operations | [Dynamic table](https://atlassian.design/components/dynamic-table/), [design tokens](https://atlassian.design/foundations/tokens) |
| [Fluent UI](./fluent.html) · [image](./fluent.png) | Light layered surfaces, grouped controls, fine separators | [Toolbar usage](https://fluent2.microsoft.design/components/web/react/core/toolbar/usage/), [design tokens](https://fluent2.microsoft.design/design-tokens) |
| [eBay Evo](./ebay.html) · [image](./ebay.png) | Prominent search, visible filter chips, self-contained result cards | [Search field](https://playbook.ebay.com/design-system/components/search-field), [filtering pattern](https://playbook.ebay.com/design-system/patterns/filtering-patterns) |

The DTS workflow facts stay constant so the difference is the design treatment. Status is always
written out; priority is separate from status; custody is labeled “Currently with.” The records,
counts, and dates are fictional. The visible controls are illustrations, not working app controls.

These concepts are for choosing a direction before changing the current shadcn/Radix and Material 3
implementation. The [redesign proposal](../design-system-redesign-draft.md) describes the existing
code seams and validation needed for a real implementation.
