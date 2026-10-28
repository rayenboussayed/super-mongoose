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
          count: { type: "Number", status: "up", min: 0 },
        },
        indexes: [
          { status: "up", fields: { status: 1, name: 1 }, name: "status_1_name_1" },
        ],
      },
    },
  },
];
