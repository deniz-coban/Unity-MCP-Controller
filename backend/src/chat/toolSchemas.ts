const vector3Schema = (description: string) => ({
  type: "object",
  description,
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    z: { type: "number" }
  },
  required: ["x", "y", "z"],
  additionalProperties: false
});

const optionalTransformProperties = {
  position: vector3Schema("World position in Unity units."),
  rotation: vector3Schema("Euler rotation in degrees."),
  scale: vector3Schema("Scale. Each axis must be greater than 0.")
};

const partialVector3Schema = (description: string) => ({
  type: "object",
  description,
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    z: { type: "number" }
  },
  additionalProperties: false
});

export const chatToolSchemas = [
  {
    type: "function",
    name: "list_scene_objects",
    description:
      "List the current Unity scene objects. Use this before editing by name, answering scene-state questions, or choosing instanceIds.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "get_scene_object_details",
    description:
      "Get detailed transform and component information for one scene object by instanceId.",
    parameters: {
      type: "object",
      properties: {
        instanceId: {
          type: "number",
          description: "The Unity instanceId returned by list_scene_objects."
        }
      },
      required: ["instanceId"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "create_default_object",
    description:
      "Create one safe Unity primitive object using existing app validation and Unity client logic.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["cube", "sphere", "capsule", "cylinder", "plane", "quad"]
        },
        name: {
          type: "string",
          description:
            "Requested object name. Duplicate-name handling is done by the backend."
        },
        position: optionalTransformProperties.position,
        rotation: optionalTransformProperties.rotation,
        scale: optionalTransformProperties.scale,
        textureAttachmentId: {
          type: "string",
          description:
            "Optional uploaded texture attachment id. Use only ids shown in the user's available attachments."
        }
      },
      required: ["type"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "create_object_grid",
    description:
      "Create a rectangular grid of safe Unity primitive objects. Use for batch layout requests. Hard maximum is enforced by the backend.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["cube", "sphere", "capsule", "cylinder", "plane", "quad"]
        },
        baseName: {
          type: "string",
          description: "Base object name, such as Cube."
        },
        rows: { type: "number", description: "Positive integer row count." },
        columns: { type: "number", description: "Positive integer column count." },
        spacing: {
          type: "number",
          description:
            "Optional distance between object centers. If omitted, the backend uses max(scale.x, scale.z) so grid objects touch for uniform scale."
        },
        startPosition: vector3Schema("World position of the first grid item."),
        rotation: optionalTransformProperties.rotation,
        scale: optionalTransformProperties.scale
      },
      required: ["type", "rows", "columns"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "create_light",
    description:
      "Create a Directional, Point, or Spot light with safe high-level settings. Use range only for Point or Spot lights. Use spotAngle only for Spot lights.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["directional", "point", "spot"] },
        name: { type: "string" },
        position: optionalTransformProperties.position,
        rotation: optionalTransformProperties.rotation,
        intensity: {
          type: "number",
          description: "Light intensity. Must be greater than or equal to 0."
        },
        color: {
          type: "string",
          description: "Hex color in #RRGGBB or #RRGGBBAA format."
        },
        range: {
          type: "number",
          description:
            "Optional light range for Point or Spot lights. Must be greater than 0. Omit this field if the user did not request range; do not send 0 as a placeholder."
        },
        spotAngle: {
          type: "number",
          description:
            "Optional spot angle for Spot lights only. Must be > 0 and <= 179. Omit this field if the user did not request spot angle; do not send 0 as a placeholder."
        }
      },
      required: ["type"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "move_object",
    description:
      "Move one existing object by instanceId. Only changes position; preserves rotation and scale. Call list_scene_objects first when the user gives only a name.",
    parameters: {
      type: "object",
      properties: {
        instanceId: {
          type: "number",
          description: "The exact instanceId from list_scene_objects."
        },
        mode: {
          type: "string",
          enum: ["absolute", "relative"],
          description:
            "Use absolute for 'move to/set position'. Use relative for 'move by/up/down/left/right'. Defaults to absolute."
        },
        position: partialVector3Schema(
          "Position axes to set or offset. Include only axes that should change."
        )
      },
      required: ["instanceId", "position"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "rotate_object",
    description:
      "Rotate one existing object by instanceId. Only changes rotation; preserves position and scale. Call list_scene_objects first when the user gives only a name.",
    parameters: {
      type: "object",
      properties: {
        instanceId: {
          type: "number",
          description: "The exact instanceId from list_scene_objects."
        },
        mode: {
          type: "string",
          enum: ["absolute", "relative"],
          description:
            "Use absolute for 'rotate to/set rotation'. Use relative for 'rotate by/more/add degrees'. Defaults to absolute."
        },
        rotation: partialVector3Schema(
          "Euler rotation axes in degrees. Include only axes that should change."
        )
      },
      required: ["instanceId", "rotation"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "scale_object",
    description:
      "Scale one existing object by instanceId. Only changes scale; preserves position and rotation. Call list_scene_objects first when the user gives only a name.",
    parameters: {
      type: "object",
      properties: {
        instanceId: {
          type: "number",
          description: "The exact instanceId from list_scene_objects."
        },
        mode: {
          type: "string",
          enum: ["absolute", "multiply"],
          description:
            "Use absolute for 'scale to/set scale'. Use multiply for 'make twice/half as large'. Defaults to absolute."
        },
        scale: partialVector3Schema(
          "Scale axes to set or multiply. Include only axes that should change; values must be greater than 0."
        )
      },
      required: ["instanceId", "scale"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "rename_object",
    description:
      "Rename one existing object by instanceId. Only changes the object name; preserves transform, light, material, and renderer data. Call list_scene_objects first when the user gives only a name.",
    parameters: {
      type: "object",
      properties: {
        instanceId: {
          type: "number",
          description: "The exact instanceId from list_scene_objects."
        },
        name: {
          type: "string",
          description: "The requested new object name. The backend will make it unique if needed."
        }
      },
      required: ["instanceId", "name"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "edit_light",
    description:
      "Edit light-specific fields on an existing Light object by instanceId. Call list_scene_objects first and use this only for objects where hasLight is true. Use spotAngle only for Spot lights.",
    parameters: {
      type: "object",
      properties: {
        instanceId: {
          type: "number",
          description: "The exact instanceId of a Light object from list_scene_objects."
        },
        color: {
          type: "string",
          description: "Optional hex color in #RRGGBB or #RRGGBBAA format."
        },
        intensity: {
          type: "number",
          description: "Optional light intensity. Must be greater than or equal to 0."
        },
        range: {
          type: "number",
          description: "Optional range for Point or Spot lights. Must be greater than 0."
        },
        spotAngle: {
          type: "number",
          description: "Optional spot angle for Spot lights only. Must be > 0 and <= 179."
        }
      },
      required: ["instanceId"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "batch_move_objects",
    description:
      "Move multiple existing objects by explicit instanceIds. Only changes position; preserves rotation and scale. Use only after list_scene_objects has identified exact objects.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["absolute", "relative"],
          description:
            "Use absolute for explicit layout/spacing positions. Use relative for offsets. Defaults to absolute."
        },
        edits: {
          type: "array",
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              instanceId: { type: "number" },
              position: partialVector3Schema(
                "Position axes to set or offset for this object."
              )
            },
            required: ["instanceId", "position"],
            additionalProperties: false
          }
        }
      },
      required: ["edits"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "batch_rotate_objects",
    description:
      "Rotate multiple existing objects by explicit instanceIds. Only changes rotation; preserves position and scale. Use only after list_scene_objects has identified exact objects.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["absolute", "relative"],
          description:
            "Use absolute for explicit final rotations. Use relative for rotation deltas. Defaults to absolute."
        },
        edits: {
          type: "array",
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              instanceId: { type: "number" },
              rotation: partialVector3Schema(
                "Euler rotation axes in degrees for this object."
              )
            },
            required: ["instanceId", "rotation"],
            additionalProperties: false
          }
        }
      },
      required: ["edits"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "batch_scale_objects",
    description:
      "Scale multiple existing objects by explicit instanceIds. Only changes scale; preserves position and rotation. Use only after list_scene_objects has identified exact objects.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["absolute", "multiply"],
          description:
            "Use absolute for explicit final scale. Use multiply for proportional scaling. Defaults to absolute."
        },
        edits: {
          type: "array",
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              instanceId: { type: "number" },
              scale: partialVector3Schema(
                "Scale axes to set or multiply for this object; values must be greater than 0."
              )
            },
            required: ["instanceId", "scale"],
            additionalProperties: false
          }
        }
      },
      required: ["edits"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "import_model",
    description:
      "Import an uploaded model attachment, optionally with an uploaded texture attachment. Use attachment ids, never raw binary data.",
    parameters: {
      type: "object",
      properties: {
        modelAttachmentId: { type: "string" },
        textureAttachmentId: { type: "string" },
        name: { type: "string" },
        position: optionalTransformProperties.position,
        rotation: optionalTransformProperties.rotation,
        scale: optionalTransformProperties.scale
      },
      required: ["modelAttachmentId", "name"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "save_scene",
    description: "Save the current Unity scene using existing safe save behavior.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  }
] as const;
