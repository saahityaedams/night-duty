"""
Pipeline check: proves Blender can be driven headless to build, bevel and export a model.

Run:  npm run blender -- tools/blender/pipeline_check.py -- <output.glb>
"""
import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out_path = argv[0] if argv else "assets-src/pipeline_check.glb"

# Start from an empty scene.
bpy.ops.wm.read_factory_settings(use_empty=True)

# A monitor-sized box with real bevels, the basic building block of the hard-surface props.
bpy.ops.mesh.primitive_cube_add(size=1)
obj = bpy.context.active_object
obj.name = "PipelineCheck"
obj.scale = (0.54, 0.34, 0.03)
bpy.ops.object.transform_apply(scale=True)

bevel = obj.modifiers.new("Bevel", "BEVEL")
bevel.width = 0.004
bevel.segments = 3
bevel.limit_method = "ANGLE"
bpy.ops.object.modifier_apply(modifier=bevel.name)
bpy.ops.object.shade_smooth_by_angle()

mat = bpy.data.materials.new("Plastic")
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get("Principled BSDF")
bsdf.inputs["Base Color"].default_value = (0.05, 0.05, 0.055, 1.0)
bsdf.inputs["Roughness"].default_value = 0.45
obj.data.materials.append(mat)

bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", use_selection=False)

mesh = obj.data
print(f"PIPELINE_OK verts={len(mesh.vertices)} faces={len(mesh.polygons)} out={out_path}")
