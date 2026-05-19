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
  },
  {
    type: "function",
    name: "delete_object",
    description:
      "Request deletion of one Unity object by instanceId. DESTRUCTIVE. This tool only creates a confirmation prompt for the user in the UI — it does NOT delete on its own. The user clicks Confirm or Cancel; the backend resolves the deletion outside this chat call. For deleting many objects at once, use delete_objects instead.",
    parameters: {
      type: "object",
      properties: {
        instanceId: {
          type: "number",
          description: "The exact instanceId from list_scene_objects."
        }
      },
      required: ["instanceId"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "delete_objects",
    description:
      "Request deletion of MANY Unity objects in one prompt by instanceId list. DESTRUCTIVE. Like delete_object, this only creates a single confirmation prompt for the user; it never deletes on its own. Use for 'delete all', 'delete every X', or any multi-target deletion request after calling list_scene_objects.",
    parameters: {
      type: "object",
      properties: {
        instanceIds: {
          type: "array",
          description: "Array of exact instanceIds from list_scene_objects. Must be non-empty.",
          items: { type: "number" }
        }
      },
      required: ["instanceIds"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "duplicate_object",
    description:
      "Duplicate one existing object by instanceId. Copies type, name (deduped), and transform. For lights, also copies light properties. For imported models this is not supported in v1.",
    parameters: {
      type: "object",
      properties: {
        instanceId: {
          type: "number",
          description: "The exact instanceId from list_scene_objects."
        },
        newName: {
          type: "string",
          description: "Optional requested name. Backend dedupes if needed."
        },
        positionOffset: {
          type: "object",
          description:
            "Optional offset added to the source position. Include only axes that should shift. Defaults to no offset (duplicate overlaps the source).",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" }
          },
          additionalProperties: false
        }
      },
      required: ["instanceId"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "apply_texture_to_object",
    description:
      "Apply an uploaded texture attachment to an existing renderable object's first material slot. REPLACES the object's current generated material. Only use textureAttachmentId values from the available attachments list.",
    parameters: {
      type: "object",
      properties: {
        instanceId: {
          type: "number",
          description: "The exact instanceId from list_scene_objects."
        },
        textureAttachmentId: {
          type: "string",
          description: "Uploaded texture attachment id. Must be a texture attachment."
        }
      },
      required: ["instanceId", "textureAttachmentId"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "set_material_color",
    description:
      "Set a solid color on an existing renderable object's material. REPLACES the object's current generated material with a fresh one in the chosen color. Any previous texture on the object is lost.",
    parameters: {
      type: "object",
      properties: {
        instanceId: {
          type: "number",
          description: "The exact instanceId from list_scene_objects."
        },
        color: {
          type: "string",
          description: "Hex color in #RRGGBB or #RRGGBBAA format."
        }
      },
      required: ["instanceId", "color"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "batch_apply_texture_to_objects",
    description:
      "Apply the SAME uploaded texture to MANY existing renderable objects in one call. Use this whenever the user wants a texture on several objects (e.g. every cube in a grid, all imported models). Creates one shared material and assigns it to every target. REPLACES each target's current generated material.",
    parameters: {
      type: "object",
      properties: {
        instanceIds: {
          type: "array",
          description: "Exact instanceIds from list_scene_objects. Non-empty.",
          items: { type: "number" }
        },
        textureAttachmentId: {
          type: "string",
          description: "Uploaded texture attachment id. Must be a texture attachment."
        }
      },
      required: ["instanceIds", "textureAttachmentId"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "find_online_model",
    description:
      "Search free 3D model catalogs (Poly Pizza, Sketchfab) for a model matching the user's request and present 1-6 candidates as a UI confirmation card. The user picks one of the options to actually import it; this tool does NOT add anything to the scene on its own. Use whenever the user asks to add a real-world object you don't have locally (e.g. 'add a bicycle', 'put a coffee mug on the table'). Use simple common-noun queries (e.g. 'bicycle' not 'Specialized Tarmac SL7').",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search keyword. Plain common-noun queries work best (e.g. 'bicycle', 'tree', 'lamp post')."
        },
        sources: {
          type: "string",
          enum: ["poly_pizza", "sketchfab", "both"],
          description:
            "Which catalog(s) to query. Defaults to 'both' when omitted."
        },
        name: {
          type: "string",
          description:
            "Optional GameObject name in Unity after import. Defaults to the catalog model title."
        },
        position: {
          type: "object",
          description:
            "Optional initial world position. Defaults to (0,0,0).",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" }
          },
          required: ["x", "y", "z"],
          additionalProperties: false
        },
        rotation: {
          type: "object",
          description: "Optional initial euler rotation in degrees.",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" }
          },
          required: ["x", "y", "z"],
          additionalProperties: false
        },
        scale: {
          type: "object",
          description: "Optional initial scale. Each axis must be > 0.",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            z: { type: "number" }
          },
          required: ["x", "y", "z"],
          additionalProperties: false
        }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "batch_set_material_color",
    description:
      "Set the SAME solid color on MANY existing renderable objects in one call. Use this whenever the user wants a color on several objects (e.g. make every cube red). Creates one shared material and assigns it to every target. REPLACES each target's current generated material; previous textures are lost.",
    parameters: {
      type: "object",
      properties: {
        instanceIds: {
          type: "array",
          description: "Exact instanceIds from list_scene_objects. Non-empty.",
          items: { type: "number" }
        },
        color: {
          type: "string",
          description: "Hex color in #RRGGBB or #RRGGBBAA format."
        }
      },
      required: ["instanceIds", "color"],
      additionalProperties: false
    }
  }
] as const;
