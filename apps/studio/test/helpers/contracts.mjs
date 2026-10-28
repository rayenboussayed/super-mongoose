export const contracts = [
  {
    version: "20260101000000",
    models: {
      Widget: {
        name: "Widget",
        collection: "studio_widgets",
        fields: {
          name: { type: "String", status: "up", required: true },
          status: { type: "String", status: "up", enum: ["draft", "active"] },
        },
        indexes: [
          { status: "up", fields: { name: 1 }, name: "name_1" },
        ],
      },
    },
  },
];
