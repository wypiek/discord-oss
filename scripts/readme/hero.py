import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1 :]
root, out, width, samples = args[0], args[1], int(args[2]), int(args[3])
icon_svg = str(Path(__file__).resolve().parents[2] / "assets/public/branding/meowcord-icon.svg")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def hex_color(value):
    value = value.lstrip("#")
    srgb = [int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4) for c in srgb) + (1,)


def material(name, color, roughness=0.4, coat=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = hex_color(color)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Coat Weight"].default_value = coat
    bsdf.inputs["Coat Roughness"].default_value = 0.08
    return mat


white = material("cat", "#ffffff", 0.3, 0.2)
whisker_white = material("whiskers", "#e4def8", 0.35, 0.2)


def make_icon(color, size, location, rotation):
    before = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=icon_svg)
    parts = [o for o in bpy.data.objects if o not in before]
    bpy.context.view_layer.update()
    rect = max(parts, key=lambda o: o.dimensions.x * o.dimensions.y)
    factor = size / rect.dimensions.x
    corners = [rect.matrix_world @ Vector(c) for c in rect.bound_box]
    center = sum(corners, Vector()) / 8
    holder = bpy.data.objects.new("icon", None)
    scene.collection.objects.link(holder)
    tile = material(f"tile-{color}", color, 0.32, 0.7)
    for part in parts:
        part.parent = holder
        part.location = (part.location - center) * factor
        part.scale = (factor, factor, factor)
        curve = part.data
        curve.dimensions = "2D"
        curve.fill_mode = "BOTH"
        curve.resolution_u = 24
        curve.materials.clear()
        if part is rect:
            curve.extrude = 0.075 * size / factor
            curve.bevel_depth = 0.03 * size / factor
            curve.bevel_resolution = 8
            curve.materials.append(tile)
        else:
            whiskers = part is min((o for o in parts if o is not rect), key=lambda o: o.dimensions.y)
            curve.extrude = (0.012 if whiskers else 0.026) * size / factor
            curve.bevel_depth = 0.008 * size / factor
            curve.bevel_resolution = 4
            curve.offset = 0
            part.location.z = (0.092 if whiskers else 0.118) * size
            curve.materials.append(whisker_white if whiskers else white)
    face = next(o for o in parts if o is not rect and o.data.materials[0] is white)
    whisker = next(o for o in parts if o is not rect and o is not face)
    cutter = face.copy()
    cutter.data = face.data.copy()
    scene.collection.objects.link(cutter)
    cutter.data.offset = 0.021 * size / factor
    cutter.data.extrude = 0.3 * size / factor
    cutter.data.bevel_depth = 0
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    whisker_mesh = bpy.data.meshes.new_from_object(whisker.evaluated_get(depsgraph))
    cutter_mesh = bpy.data.meshes.new_from_object(cutter.evaluated_get(depsgraph))
    cut_obj = bpy.data.objects.new("cutter", cutter_mesh)
    scene.collection.objects.link(cut_obj)
    cut_obj.parent = holder
    cut_obj.location = cutter.location
    cut_obj.scale = cutter.scale
    cut_obj.hide_render = True
    bpy.data.objects.remove(cutter)
    new_whisker = bpy.data.objects.new("whiskers", whisker_mesh)
    scene.collection.objects.link(new_whisker)
    new_whisker.parent = holder
    new_whisker.location = whisker.location
    new_whisker.scale = whisker.scale
    bpy.data.objects.remove(whisker)
    boolean = new_whisker.modifiers.new("gap", "BOOLEAN")
    boolean.operation = "DIFFERENCE"
    boolean.object = cut_obj
    holder.location = location
    holder.rotation_euler = [math.radians(a) for a in rotation]
    return holder


def screen(image_path, location, rotation, height):
    image = bpy.data.images.load(image_path)
    aspect = image.size[0] / image.size[1]
    w = height * aspect
    bpy.ops.mesh.primitive_cube_add(size=1)
    body = bpy.context.object
    body.scale = (w + 0.12, height + 0.12, 0.08)
    bevel = body.modifiers.new("bevel", "BEVEL")
    bevel.width = 0.05
    bevel.segments = 6
    body.data.materials.append(material("bezel", "#16131f", 0.35, 0.5))
    bpy.ops.mesh.primitive_plane_add(size=1)
    face = bpy.context.object
    face.scale = (w, height, 1)
    face.location.z = 0.041
    bpy.context.view_layer.update()
    face.parent = body
    face.matrix_parent_inverse = body.matrix_world.inverted()
    mat = bpy.data.materials.new("screen")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes["Principled BSDF"]
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Cubic"
    bsdf.inputs["Base Color"].default_value = (0, 0, 0, 1)
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.22
    bsdf.inputs["Specular IOR Level"].default_value = 0.06
    face.data.materials.append(mat)
    body.location = location
    body.rotation_euler = [math.radians(a) for a in rotation]
    return body


screen(f"{root}/discovery.png", (3.35, 3.2, 0.3), (90, 0, -27), 4.9)
screen(f"{root}/chat.png", (-2.95, 2.6, 0.05), (90, 0, 26), 4.9)

make_icon("#7B5CFF", 1.75, (0.15, -2.1, -0.05), (90 - 8, 0, -14))
for color, size, location, rotation in [
    ("#3BA55D", 0.4, (3.05, -1.6, -1.12), (98, -10, -30)),
    ("#FAA61A", 0.28, (0.22, -3.0, 1.66), (70, 18, -8)),
]:
    make_icon(color, size, location, rotation)

bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 14, 0.5), rotation=(math.radians(90), 0, 0))
backdrop = bpy.context.object
backdrop.scale = (60, 34, 1)
glow = bpy.data.materials.new("backdrop")
glow.use_nodes = True
glow_nodes = glow.node_tree.nodes
glow_nodes.remove(glow_nodes["Principled BSDF"])
coords = glow_nodes.new("ShaderNodeTexCoord")
mapping = glow_nodes.new("ShaderNodeMapping")
mapping.inputs["Scale"].default_value = (1.6, 2.6, 1)
mapping.inputs["Location"].default_value = (-0.8, -1.25, 0)
gradient = glow_nodes.new("ShaderNodeTexGradient")
gradient.gradient_type = "SPHERICAL"
ramp = glow_nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.interpolation = "EASE"
ramp.color_ramp.elements[0].color = hex_color("#040406")
ramp.color_ramp.elements[1].color = hex_color("#2a2540")
emission = glow_nodes.new("ShaderNodeEmission")
glow_links = glow.node_tree.links
glow_links.new(coords.outputs["Generated"], mapping.inputs["Vector"])
glow_links.new(mapping.outputs["Vector"], gradient.inputs["Vector"])
glow_links.new(gradient.outputs["Fac"], ramp.inputs["Fac"])
glow_links.new(ramp.outputs["Color"], emission.inputs["Color"])
glow_links.new(emission.outputs["Emission"], glow_nodes["Material Output"].inputs["Surface"])
backdrop.data.materials.append(glow)

world = bpy.data.worlds.new("world")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = hex_color("#020203")
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0


def light(name, location, target, power, size, color, spread=180):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = power
    data.size = size
    data.spread = math.radians(spread)
    data.color = hex_color(color)[:3]
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.visible_camera = False
    obj.location = location
    obj.rotation_euler = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y").to_euler()


light("key", (-5, -7, 5), (0, 0, 0), 260, 6, "#fff4ea", 55)
light("fill", (6, -6, -1), (0, 0, 0), 110, 6, "#c9c0ff", 60)
light("rim", (0, 4, 5), (0, -1, 0), 900, 4, "#9d85ff")

camera = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
scene.collection.objects.link(camera)
scene.camera = camera
camera.location = (0.3, -10.5, 1.4)
camera.rotation_euler = (Vector((0, 0.4, 0.15)) - camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.lens = 42
camera.data.dof.use_dof = True
camera.data.dof.focus_distance = (Vector((0.15, -2.1, -0.05)) - camera.location).length
camera.data.dof.aperture_fstop = 2.6

scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "METAL"
prefs.get_devices()
for device in prefs.devices:
    device.use = True
scene.cycles.device = "GPU"
scene.cycles.samples = samples
scene.cycles.use_denoising = True
scene.render.resolution_x = width
scene.render.resolution_y = width // 2
scene.render.film_transparent = False
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
