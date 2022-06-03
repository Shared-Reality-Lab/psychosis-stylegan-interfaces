// version: 0.0.90

/**
 *
 * General structure of this viewer
 *
 * The code below creates a webgl scene that visualizes many images. To do so,
 * it loads a series of "atlas" images (.jpg files that contain lots of smaller
 * image "cells", where each cell depicts a single input image in a small size).
 * Those atlases are combined into "textures", where each texture is just a 2D
 * canvas with image data from one or more atlas images. Those textures are fed
 * to the GPU to control the content that each individual image in the scene
 * will display.
 *
 * The positions of each cell are controlled by the data in plot_data.json,
 * which is created by utils/process_images.py. As users move through the scene,
 * higher detail images are requested for the images that are proximate to the
 * user's camera position. Those higher resolution images are loaded by the LOD()
 * "class" below.
 *
 **/

/**
 * Config: The master config for this visualization.
 *   Contains the following attributes:
 *
 * data:
 *   url: name of the directory where input data lives
 *   file: name of the file with positional data
 *   gzipped: boolean indicating whether the JSON data is gzipped
 * size:
 *   cell: height & width of each image (in px) within the small atlas
 *   lodCell: height & width of each image (in px) within the larger atlas
 *   atlas: height & width of each small atlas (in px)
 *   texture: height & width of each texture (in px)
 *   lodTexture: height & width of the large (detail) texture
 transition:
 *   duration: number of seconds each layout transition should take
 *   ease: TweenLite ease config values for transitions
 * atlasesPerTex: number of atlases to include in each texture
 **/

function Config() {
    this.data = {
        dir: 'data',
        file: 'manifest.json',
        gzipped: false,
    };
    this.size = {
        cell: 32, // height of each cell in atlas
        lodCell: 128, // height of each cell in LOD
        atlas: 2048, // height of each atlas
        texture: webgl.limits.textureSize,
        lodTexture: 2 ** 13,
        points: {
            min: 0, // min point size
            max: 0, // max point size
            initial: 0, // initial point size
            grid: 0, // initial point size for grid layouts
            scatter: 0, // initial point size for scatter layouts
            date: 0 // initial point size for date layouts
        }
    };
    this.transitions = {
        duration: 2.0,
        delay: 0.5
    };
    this.transitions.ease = {
        value: 1.0 + this.transitions.delay,
        ease: Power3.easeOut
    };
    this.pickerMaxZ = 0.4; // max z value of camera to trigger picker modal
    this.atlasesPerTex = (this.size.texture / this.size.atlas) ** 2;
    this.lassoEnabled = false;
}

/**
 * Data: Container for data consumed by application
 *
 * atlasCount: total number of atlases to load; specified in config.data.file
 * textureCount: total number of textures to create
 * textures: array of Texture objects to render. Each requires a draw call
 * layout: string layout for the currently active layout in json.layouts
 * layouts: array of layouts, each with 2 or 3D positional attributes per cell
 * cells: array of images to render. Each depicts a single input image
 * textureProgress: maps texture index to its loading progress (0:100)
 * textureCount: total number of textures to load
 * loadedTextures: number of textures loaded so far
 * boundingBox: the domains for the x and y axes. Used for setting initial
 *   camera position and creating the LOD grid
 **/

function Data() {
    this.atlasCount = null;
    this.textureCount = null;
    this.layouts = [];
    this.cells = [];
    this.textures = [];
    this.textureProgress = {};
    this.loadedTextures = 0;
    this.boundingBox = {
        x: {min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY},
        y: {min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY}
    };
    world.getHeightMap(this.load.bind(this));
}

// Load json data with chart element positions
Data.prototype.load = function () {
    get(getPath(config.data.dir + '/' + config.data.file),
        function (json) {
            get(getPath(json.imagelist), function (data) {
                this.parseManifest(Object.assign({}, json, data));
            }.bind(this))
        }.bind(this),
        function (err) {
            if (!config.data.gzipped) {
                config.data.gzipped = true;
                config.data.file = config.data.file + '.gz';
                this.load()
            } else {
                console.warn('ERROR: could not load manifest.json')
            }
        }.bind(this)
    )
};

Data.prototype.parseManifest = function (json) {
    this.json = json;
    // set sizes of cells, atlases, and points
    config.size.cell = json.config.sizes.cell;
    config.size.atlas = json.config.sizes.atlas;
    config.size.lodCell = json.config.sizes.lod;
    config.size.points = json.point_sizes;
    // update the point size DOM element
    world.elems.pointSize.min = 0;
    world.elems.pointSize.max = config.size.points.max;
    world.elems.pointSize.value = config.size.points.initial;
    // set number of atlases and textures
    this.atlasCount = json.atlas.count;
    this.textureCount = Math.ceil(json.atlas.count / config.atlasesPerTex);
    this.layouts = json.layouts;
    this.hotspots = new Hotspots();
    layout.init(Object.keys(this.layouts));
    // load each texture for this data set
    for (let i = 0; i < this.textureCount; i++) {
        this.textures.push(new Texture({
            idx: i,
            onProgress: this.onTextureProgress.bind(this),
            onLoad: this.onTextureLoad.bind(this)
        }));
    }
    // add cells to the world
    get(getPath(this.layouts[layout.selected].layout), this.addCells.bind(this))
};

// When a texture's progress updates, update the aggregate progress
Data.prototype.onTextureProgress = function (texIdx, progress) {
    this.textureProgress[texIdx] = progress / this.textures[texIdx].getAtlasCount(texIdx);
    welcome.updateProgress();
};

// When a texture loads, draw plot if all have loaded
Data.prototype.onTextureLoad = function (texIdx) {
    this.loadedTextures += 1;
    welcome.updateProgress();
};

// Add all cells to the world
Data.prototype.addCells = function (positions) {
    // datastore indicating data in current draw call
    let drawcall = {
        idx: 0, // idx of draw call among all draw calls
        textures: [], // count of textures in current draw call
        vertices: 0 // count of vertices in current draw call
    };
    // create all cells
    let idx = 0; // index of cell among all cells
    for (let i = 0; i < this.json.cell_sizes.length; i++) { // atlas index
        for (let j = 0; j < this.json.cell_sizes[i].length; j++) { // cell index within atlas
            drawcall.vertices++;
            let worldPos = positions[idx], // position of cell in world -1:1
                atlasPos = this.json.atlas.positions[i][j], // idx-th cell position in atlas
                atlasOffset = getAtlasOffset(i),
                size = this.json.cell_sizes[i][j];
            this.cells.push(new Cell({
                idx: idx, // index of cell among all cells
                w: size[0], // width of cell in lod atlas
                h: size[1], // height of cell in lod atlas
                x: worldPos[0], // x position of cell in world
                y: worldPos[1], // y position of cell in world
                z: worldPos[2] || null, // z position of cell in world
                dx: atlasPos[0] + atlasOffset.x, // x offset of cell in atlas
                dy: atlasPos[1] + atlasOffset.y // y offset of cell in atlas
            }));
            idx++;
        }
    }
    // add the cells to a searchable LOD texture
    lod.indexCells();
};

/**
 * Texture: Each texture contains one or more atlases, and each atlas contains
 *   many Cells, where each cell represents a single input image.
 *
 * idx: index of this texture within all textures
 * cellIndices: indices of the cells in this texture within data.cells
 * atlasProgress: map from this textures atlas id's to their load progress (0:100)
 * atlases: list of atlases used in this texture
 * atlasCount: number of atlases to load for this texture
 * onProgress: callback to tell Data() that this texture loaded a bit more
 * onLoad: callback to tell Data() that this texture finished loading
 * loadedAtlases: number of atlases loaded
 * canvas: the canvas on which each atlas in this texture will be rendered
 * ctx: the 2D context for drawing on this.canvas
 * offscreen: boolean indicating whether this canvas can be drawn offscreen
 *   (unused)
 **/

function Texture(obj) {
    this.idx = obj.idx;
    this.atlases = [];
    this.atlasProgress = {};
    this.loadedAtlases = 0;
    this.onProgress = obj.onProgress;
    this.onLoad = obj.onLoad;
    this.canvas = null;
    this.ctx = null;
    this.load();
}

Texture.prototype.setCanvas = function () {
    this.canvas = getElem('canvas', {
        width: config.size.texture,
        height: config.size.texture,
        id: 'texture-' + this.idx
    });
    this.ctx = this.canvas.getContext('2d');
};

Texture.prototype.load = function () {
    this.setCanvas();
    // load each atlas that is to be included in this texture
    for (let i = 0; i < this.getAtlasCount(); i++) {
        this.atlases.push(new Atlas({
            idx: (config.atlasesPerTex * this.idx) + i, // atlas index among all atlases
            onProgress: this.onAtlasProgress.bind(this),
            onLoad: this.onAtlasLoad.bind(this)
        }))
    }
};

// Get the number of atlases to include in this texture
Texture.prototype.getAtlasCount = function () {
    return (data.atlasCount / config.atlasesPerTex) > (this.idx + 1)
        ? config.atlasesPerTex
        : data.atlasCount % config.atlasesPerTex;
};

// Store the load progress of each atlas file
Texture.prototype.onAtlasProgress = function (atlasIdx, progress) {
    this.atlasProgress[atlasIdx] = progress;
    let textureProgress = valueSum(this.atlasProgress);
    this.onProgress(this.idx, textureProgress);
};

// Draw the loaded atlas image to this texture's canvas
Texture.prototype.onAtlasLoad = function (atlas) {
    // Add the loaded atlas file the texture's canvas
    let // atlas index within this texture
        idx = atlas.idx % config.atlasesPerTex,
        // x and y offsets within texture
        d = getAtlasOffset(idx),
        w = config.size.atlas,
        h = config.size.atlas;
    this.ctx.drawImage(atlas.image, d.x, d.y, w, h);
    // If all atlases are loaded, build the texture
    if (++this.loadedAtlases === this.getAtlasCount()) this.onLoad(this.idx);
};

// given idx of atlas among all atlases, return offsets of atlas in texture
function getAtlasOffset(idx) {
    let atlasSize = config.size.atlas,
        textureSize = config.size.texture;
    return {
        x: (idx * atlasSize) % textureSize,
        y: (Math.floor((idx * atlasSize) / textureSize) * atlasSize) % textureSize,
    }
}

/**
 * Atlas: Each atlas contains multiple Cells, and each Cell represents a single
 *   input image.
 *
 * idx: index of this atlas among all atlases
 * texIdx: index of this atlases texture among all textures
 * cellIndices: array of the indices in data.cells to be rendered by this atlas
 * size: height & width of this atlas (in px)
 * progress: total load progress for this atlas's image (0-100)
 * onProgress: callback to notify parent Texture that this atlas has loaded more
 * onLoad: callback to notify parent Texture that this atlas has finished loading
 * image: Image object with data to be rendered on this atlas
 * url: path to the image for this atlas
 * cells: list of the Cell objects rendered in this atlas
 * posInTex: the x & y offsets of this atlas in its texture (in px) from top left
 **/

function Atlas(obj) {
    this.idx = obj.idx;
    this.progress = 0;
    this.onProgress = obj.onProgress;
    this.onLoad = obj.onLoad;
    this.image = null;
    this.url = getPath(data.json.atlas_dir + '/atlas-' + this.idx + '.jpg');
    this.load();
}

Atlas.prototype.load = function () {
    this.image = new Image;
    this.image.onload = function () {
        this.onLoad(this);
    }.bind(this);
    let xhr = new XMLHttpRequest();
    xhr.onprogress = function (e) {
        let progress = parseInt((e.loaded / e.total) * 100);
        this.onProgress(this.idx, progress);
    }.bind(this);
    xhr.onload = function (e) {
        this.image.src = window.URL.createObjectURL(e.target.response);
    }.bind(this);
    xhr.open('GET', this.url, true);
    xhr.responseType = 'blob';
    xhr.send();
};

/**
 * Cell: Each cell represents a single input image.
 *
 * idx: index of this cell among all cells
 * name: the basename for this image (e.g. cats.jpg)
 * w: the width of this image in pixels
 * h: the height of this image in pixels
 * gridCoords: x,y coordinates of this image in the LOD grid -- set by LOD()
 * layouts: a map from layout name to obj with x, y, z positional values
 **/

function Cell(obj) {
    this.idx = obj.idx; // idx among all cells
    this.texIdx = this.getIndexOfTexture();
    this.gridCoords = {}; // x, y pos of the cell in the lod grid (set by lod)
    this.x = obj.x;
    this.y = obj.y;
    this.z = obj.z || this.getZ(obj.x, obj.y);
    this.tx = this.x; // target x position
    this.ty = this.y; // target y position
    this.tz = this.z; // target z position
    this.dx = obj.dx;
    this.dy = obj.dy;
    this.w = obj.w; // width of lod cell
    this.h = obj.h; // heiht of lod cell
    this.updateParentBoundingBox();
}

Cell.prototype.getZ = function (x, y) {
    return world.getHeightAt(x, y) || 0;
};

Cell.prototype.updateParentBoundingBox = function () {
    let bb = data.boundingBox;
    ['x', 'y'].forEach(function (d) {
        bb[d].max = Math.max(bb[d].max, this[d]);
        bb[d].min = Math.min(bb[d].min, this[d]);
    }.bind(this))
};

// return the index of this atlas among all atlases
Cell.prototype.getIndexOfAtlas = function () {
    let i = 0; // accumulate cells per atlas until we find this cell's atlas
    for (let j = 0; j < data.json.atlas.positions.length; j++) {
        i += data.json.atlas.positions[j].length;
        if (i > this.idx) return j;
    }
    return j;
};

// return the index of this cell within its atlas
Cell.prototype.getIndexInAtlas = function () {
    let atlasIdx = this.getIndexOfAtlas();
    let i = 0; // determine the number of cells in all atlases prior to current
    for (let j = 0; j < atlasIdx; j++) {
        i += data.json.atlas.positions[j].length;
    }
    return this.idx - i;
};

// return the index of this cell's initial (non-lod) texture among all textures
Cell.prototype.getIndexOfTexture = function () {
    return Math.floor(this.getIndexOfAtlas() / config.atlasesPerTex);
};

// return the index of this cell's draw call among all draw calls
Cell.prototype.getIndexOfDrawCall = function () {
    return Math.floor(this.idx / webgl.limits.indexedElements);
};

// return the index of this cell within its draw call
Cell.prototype.getIndexInDrawCall = function () {
    return this.idx % webgl.limits.indexedElements;
};

/**
 * Cell activation / deactivation
 **/

// make the cell active in LOD
Cell.prototype.activate = function () {
    this.dx = lod.state.cellIdxToCoords[this.idx].x;
    this.dy = lod.state.cellIdxToCoords[this.idx].y;
    this.texIdx = -1;
    ['textureIndex', 'offset'].forEach(this.setBuffer.bind(this));
};

// deactivate the cell in LOD
Cell.prototype.deactivate = function () {
    let atlasIndex = this.getIndexOfAtlas(),
        indexInAtlas = this.getIndexInAtlas(),
        atlasOffset = getAtlasOffset(atlasIndex),
        d = data.json.atlas.positions[atlasIndex][indexInAtlas];
    this.dx = d[0] + atlasOffset.x;
    this.dy = d[1] + atlasOffset.y;
    this.texIdx = this.getIndexOfTexture();
    ['textureIndex', 'offset'].forEach(this.setBuffer.bind(this));
};

// update this cell's buffer values for bound attribute `attr`
Cell.prototype.setBuffer = function (attr) {
    // find the buffer attributes that describe this cell to the GPU
    let meshes = world.group,
        attrs = meshes.children[this.getIndexOfDrawCall()].geometry.attributes,
        idxInDrawCall = this.getIndexInDrawCall();

    switch (attr) {
        case 'textureIndex':
            // set the texIdx to -1 to read from the uniforms.lodTexture
            attrs.textureIndex.array[idxInDrawCall] = this.texIdx;
            return;

        case 'offset':
            // set the x then y texture offsets for this cell
            attrs.offset.array[(idxInDrawCall * 2)] = this.dx;
            attrs.offset.array[(idxInDrawCall * 2) + 1] = this.dy;
            return;

        case 'pos0':
            // set the cell's translation
            attrs.pos0.array[(idxInDrawCall * 3)] = this.x;
            attrs.pos0.array[(idxInDrawCall * 3) + 1] = this.y;
            attrs.pos0.array[(idxInDrawCall * 3) + 2] = this.z;
            return;

        case 'pos1':
            // set the cell's translation
            attrs.pos1.array[(idxInDrawCall * 3)] = this.tx;
            attrs.pos1.array[(idxInDrawCall * 3) + 1] = this.ty;
            attrs.pos1.array[(idxInDrawCall * 3) + 2] = this.tz;
            return;
    }
};

/**
 * Layout: contols the DOM element and state that identify the layout
 *   to be displayed
 *
 * elem: DOM element for the layout selector
 * selected: currently selected layout option
 * options: list of strings identifying valid layout options
 **/

function Layout() {
    this.selected = null;
    this.options = [];
}

/**
 * @param {[string]} options: an array of layout strings; each should
 *   be an attribute in data.cells[ithCell].layouts
 **/

Layout.prototype.init = function (options) {
    this.options = options;
    this.selected = data.json.initial_layout || Object.keys(options)[0];
    data.hotspots.showHide();
};

// Transition to a new layout; layout must be an attr on Cell.layouts
Layout.prototype.set = function (layout, enableDelay) {
    // disallow new transitions when we're transitioning
    if (world.state.transitioning) return;
    if (!(layout in data.json.layouts)) return;
    world.state.transitioning = true;
    // set the selected layout
    this.selected = layout;
    // set the world mode back to pan
    world.setMode('pan');
    // set the point size given the selected layout
    this.setPointScalar();
    // zoom the user out if they're zoomed in
    let delay = this.recenterCamera(enableDelay);
    // begin the new layout transition
    setTimeout(function () {
        get(getPath(data.layouts[layout]['layout']), function (pos) {
            // clear the LOD mechanism
            lod.clear();
            // set the target locations of each point
            for (let i = 0; i < data.cells.length; i++) {
                data.cells[i].tx = pos[i][0];
                data.cells[i].ty = pos[i][1];
                data.cells[i].tz = pos[i][2] || data.cells[i].getZ(pos[i][0], pos[i][1]);
                data.cells[i].setBuffer('pos1');
            }
            // update the transition uniforms and pos1 buffers on each mesh
            for (let i = 0; i < world.group.children.length; i++) {
                world.group.children[i].geometry.attributes.pos1.needsUpdate = true;
                TweenLite.to(world.group.children[i].material.uniforms.transitionPercent,
                    config.transitions.duration, config.transitions.ease);
            }
            // prepare to update all the cell buffers once transition completes
            setTimeout(this.onTransitionComplete.bind(this), config.transitions.duration * 1000);
        }.bind(this))
    }.bind(this), delay);
};

// return the camera to its starting position
Layout.prototype.recenterCamera = function (enableDelay) {
    let initialCameraPosition = world.getInitialLocation();
    if ((world.camera.position.z < initialCameraPosition.z) && enableDelay) {
        world.flyTo(initialCameraPosition);
        return config.transitions.duration * 1000;
    }
    return 0;
};

// set the point size as a function of the current layout
Layout.prototype.setPointScalar = function () {
    let size = false, // size for points
        l = this.selected; // selected layout
    if (l === 'tsne' || l === 'umap') size = config.size.points.scatter;
    if (l === 'grid' || l === 'rasterfairy') size = config.size.points.grid;
    if (l === 'date') size = config.size.points.date;
    if (size) {
        world.elems.pointSize.value = size;
        world.setUniform('scaleTarget', world.getPointScale());
    }
};

// reset cell state, mesh buffers, and transition uniforms
Layout.prototype.onTransitionComplete = function () {
    // show/hide the hotspots
    data.hotspots.showHide();
    // update the state and buffers for each cell
    data.cells.forEach(function (cell) {
        cell.x = cell.tx;
        cell.y = cell.ty;
        cell.z = cell.tz;
        cell.setBuffer('pos0');
    });
    // pass each updated pos0 buffer to the gpu
    for (let i = 0; i < world.group.children.length; i++) {
        world.group.children[i].geometry.attributes.pos0.needsUpdate = true;
        world.group.children[i].material.uniforms.transitionPercent = {type: 'f', value: 0};
    }
    // indicate the world is no longer transitioning
    world.state.transitioning = false;
    // set the current point scale value
    world.setUniform('scale', world.getPointScale());
    // reindex cells in LOD given new positions
    lod.indexCells();
};

/**
 * World: Container object for the THREE.js scene that renders all cells
 *
 * scene: a THREE.Scene() object
 * camera: a THREE.PerspectiveCamera() object
 * renderer: a THREE.WebGLRenderer() object
 * controls: a THREE.TrackballControls() object
 * stats: a Stats() object
 * color: a THREE.Color() object
 * center: a map identifying the midpoint of cells' positions in x,y dims
 * group: the group of meshes used to render cells
 * state: a map identifying internal state of the world
 **/

function World() {
    this.canvas = document.querySelector('#pixplot-canvas');
    this.scene = this.getScene();
    this.camera = this.getCamera();
    this.renderer = this.getRenderer();
    this.controls = this.getControls();
    this.stats = this.getStats();
    this.color = new THREE.Color();
    this.center = {};
    this.group = {};
    this.state = {
        flying: false,
        transitioning: false,
        displayed: false,
        mode: 'pan' // 'pan' || 'select'
    };
    this.elems = {
        pointSize: document.querySelector('#pointsize-range-input'),
    };
    this.addEventListeners();
    if (! config.lassoEnabled) {
        document.querySelector('#selection-icons').style.display = "none";
    }
}

/**
 * Return a scene object with a background color
 **/

World.prototype.getScene = function () {
    let scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);
    return scene;
};

/**
 * Generate the camera to be used in the scene. Camera args:
 *   [0] field of view: identifies the portion of the scene
 *     visible at any time (in degrees)
 *   [1] aspect ratio: identifies the aspect ratio of the
 *     scene in width/height
 *   [2] near clipping plane: objects closer than the near
 *     clipping plane are culled from the scene
 *   [3] far clipping plane: objects farther than the far
 *     clipping plane are culled from the scene
 **/

World.prototype.getCamera = function () {
    let canvasSize = getCanvasSize();
    let aspectRatio = canvasSize.w / canvasSize.h;
    return new THREE.PerspectiveCamera(75, aspectRatio, 0.001, 10);
};

/**
 * Generate the renderer to be used in the scene
 **/

World.prototype.getRenderer = function () {
    return new THREE.WebGLRenderer({
        antialias: true,
        canvas: this.canvas,
    });
};

/**
 * Generate the controls to be used in the scene
 * camera: the three.js camera for the scene
 * renderer: the three.js renderer for the scene
 **/

World.prototype.getControls = function () {
    let controls = new THREE.TrackballControls(this.camera, this.canvas);
    controls.zoomSpeed = 0.4;
    controls.panSpeed = 0.4;
    controls.noRotate = true;
    return controls;
};

/**
 * Heightmap functions
 **/

// load the heightmap
World.prototype.getHeightMap = function (callback) {
    // load an image for setting 3d vertex positions
    let img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = function () {
        let canvas = document.createElement('canvas'),
            ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        this.heightmap = ctx.getImageData(0, 0, img.width, img.height);
        callback();
    }.bind(this);
    img.src = this.heightmap || 'assets/images/heightmap.jpg';
};

// determine the height of the heightmap at coordinates xInput,yInput
World.prototype.getHeightAt = function (xInput, yInput) {
    let x = (xInput + 1) / 2, // rescale x,y axes from -1:1 to 0:1
        y = (yInput + 1) / 2,
        row = Math.floor(y * (this.heightmap.height - 1)),
        col = Math.floor(x * (this.heightmap.width - 1)),
        idx = (row * this.heightmap.width * 4) + (col * 4),
        z = this.heightmap.data[idx] * (this.heightmapScalar / 1000 || 0.0);
    return z;
};

/**
 * Add event listeners, e.g. to resize canvas on window resize
 **/

World.prototype.addEventListeners = function () {
    this.addResizeListener();
    this.addLostContextListener();
    this.addScalarChangeListener();
    this.addTabChangeListeners();
    this.addModeChangeListeners();
};

/**
 * Resize event listeners
 **/

World.prototype.addResizeListener = function () {
    window.addEventListener('resize', this.handleResize.bind(this), false);
};

World.prototype.handleResize = function () {
    let canvasSize = getCanvasSize(),
        w = canvasSize.w * window.devicePixelRatio,
        h = canvasSize.h * window.devicePixelRatio;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.controls.handleResize();
    picker.tex.setSize(w, h);
    this.setPointScalar();
};

/**
 * Set the point size scalar as a uniform on all meshes
 **/

World.prototype.setPointScalar = function () {
    // handle case of drag before scene renders
    if (!this.state.displayed) return;
    // update the displayed and selector meshes
    this.setUniform('scale', this.getPointScale())
};

/**
 * Update the point size when the user changes the input slider
 **/

World.prototype.addScalarChangeListener = function () {
    this.elems.pointSize.addEventListener('change', this.setPointScalar.bind(this));
    this.elems.pointSize.addEventListener('input', this.setPointScalar.bind(this));
};

/**
 * Refrain from drawing scene when user isn't looking at page
 **/

World.prototype.addTabChangeListeners = function () {
    // change the canvas size to handle Chromium bug 1034019
    window.addEventListener('visibilitychange', function () {
        this.canvas.width = this.canvas.width + 1;
        setTimeout(function () {
            this.canvas.width = this.canvas.width - 1;
        }.bind(this), 50);
    }.bind(this))
};

/**
 * listen for loss of webgl context; to manually lose context:
 * world.renderer.context.getExtension('WEBGL_lose_context').loseContext();
 **/

World.prototype.addLostContextListener = function () {
    this.canvas.addEventListener('webglcontextlost', function (e) {
        e.preventDefault();
        window.location.reload();
    });
};

/**
 * Listen for changes in world.mode
 **/

World.prototype.addModeChangeListeners = function() {
    document.querySelector('#pan').addEventListener('click', this.handleModeIconClick.bind(this));
    document.querySelector('#select').addEventListener('click', this.handleModeIconClick.bind(this));
    document.querySelector('#select').addEventListener('mouseenter', this.showSelectTooltip.bind(this));
};

/**
 * Set the center point of the scene
 **/

World.prototype.setCenter = function () {
    this.center = {
        x: (data.boundingBox.x.min + data.boundingBox.x.max) / 2,
        y: (data.boundingBox.y.min + data.boundingBox.y.max) / 2,
    }
};

/**
 * Draw each of the vertices
 **/

World.prototype.plot = function () {
    // add the cells for each draw call
    let drawCallToCells = this.getDrawCallToCells();
    this.group = new THREE.Group();
    for (let drawCallIdx in drawCallToCells) {
        let meshCells = drawCallToCells[drawCallIdx],
            attrs = this.getGroupAttributes(meshCells),
            geometry = new THREE.BufferGeometry();
        geometry.setAttribute('pos0', attrs.pos0);
        geometry.setAttribute('pos1', attrs.pos1);
        geometry.setAttribute('color', attrs.color);
        geometry.setAttribute('width', attrs.width);
        geometry.setAttribute('height', attrs.height);
        geometry.setAttribute('offset', attrs.offset);
        geometry.setAttribute('opacity', attrs.opacity);
        geometry.setAttribute('selected', attrs.selected);
        geometry.setAttribute('textureIndex', attrs.textureIndex);
        geometry.setDrawRange(0, meshCells.length); // points not rendered unless draw range is specified
        let material = this.getShaderMaterial({
            firstTex: attrs.texStartIdx,
            textures: attrs.textures,
            useColor: false,
        });
        material.transparent = true;
        let mesh = new THREE.Points(geometry, material);
        mesh.frustumCulled = false;
        this.group.add(mesh);
    }
    this.scene.add(this.group);
};

/**
 * Find the index of each cell's draw call
 **/

World.prototype.getDrawCallToCells = function () {
    let drawCallToCells = {};
    for (let i = 0; i < data.cells.length; i++) {
        let cell = data.cells[i],
            drawCall = cell.getIndexOfDrawCall();
        if (!(drawCall in drawCallToCells)) {
            drawCallToCells[drawCall] = [cell];
        } else {
            drawCallToCells[drawCall].push(cell);
        }
    }
    return drawCallToCells;
};

/**
 * Return attribute data for the initial draw call of a mesh
 **/

World.prototype.getGroupAttributes = function (cells) {
    let it = this.getCellIterators(cells.length);
    for (let i = 0; i < cells.length; i++) {
        let cell = cells[i];
        let rgb = this.color.setHex(cells[i].idx + 1); // use 1-based ids for colors
        it.texIndex[it.texIndexIterator++] = cell.texIdx; // index of texture among all textures -1 means LOD texture
        it.pos0[it.pos0Iterator++] = cell.x; // current position.x
        it.pos0[it.pos0Iterator++] = cell.y; // current position.y
        it.pos0[it.pos0Iterator++] = cell.z; // current position.z
        it.pos1[it.pos1Iterator++] = cell.tx; // target position.x
        it.pos1[it.pos1Iterator++] = cell.ty; // target position.y
        it.pos1[it.pos1Iterator++] = cell.tz; // target position.z
        it.color[it.colorIterator++] = rgb.r; // could be single float
        it.color[it.colorIterator++] = rgb.g; // unique color for GPU picking
        it.color[it.colorIterator++] = rgb.b; // unique color for GPU picking
        it.opacity[it.opacityIterator++] = 1.0; // cell opacity value
        it.selected[it.selectedIterator++] = 0.0; // 1.0 if cell is selected, else 0.0
        it.width[it.widthIterator++] = cell.w; // px width of cell in lod atlas
        it.height[it.heightIterator++] = cell.h; // px height of cell in lod atlas
        it.offset[it.offsetIterator++] = cell.dx; // px offset of cell from left of tex
        it.offset[it.offsetIterator++] = cell.dy; // px offset of cell from top of tex
    }

    // format the arrays into THREE attributes
    let pos0 = new THREE.BufferAttribute(it.pos0, 3, true, 1),
        pos1 = new THREE.BufferAttribute(it.pos1, 3, true, 1),
        color = new THREE.BufferAttribute(it.color, 3, true, 1),
        opacity = new THREE.BufferAttribute(it.opacity, 1, true, 1),
        selected = new THREE.Uint8BufferAttribute(it.selected, 1, false, 1),
        texIndex = new THREE.Int8BufferAttribute(it.texIndex, 1, false, 1),
        width = new THREE.Uint8BufferAttribute(it.width, 1, false, 1),
        height = new THREE.Uint8BufferAttribute(it.height, 1, false, 1),
        offset = new THREE.Uint16BufferAttribute(it.offset, 2, false, 1);
    texIndex.usage = THREE.DynamicDrawUsage;
    pos0.usage = THREE.DynamicDrawUsage;
    pos1.usage = THREE.DynamicDrawUsage;
    opacity.usage = THREE.DynamicDrawUsage;
    selected.usage = THREE.DynamicDrawUsage;
    offset.usage = THREE.DynamicDrawUsage;
    let texIndices = this.getTexIndices(cells);
    return {
        pos0: pos0,
        pos1: pos1,
        color: color,
        width: width,
        height: height,
        offset: offset,
        opacity: opacity,
        selected: selected,
        textureIndex: texIndex,
        textures: this.getTextures({
            startIdx: texIndices.first,
            endIdx: texIndices.last,
        }),
        texStartIdx: texIndices.first,
        texEndIdx: texIndices.last
    }
};

/**
 * Get the iterators required to store attribute data for `n` cells
 **/

World.prototype.getCellIterators = function (n) {
    return {
        pos0: new Float32Array(n * 3),
        pos1: new Float32Array(n * 3),
        color: new Float32Array(n * 3),
        width: new Uint8Array(n),
        height: new Uint8Array(n),
        offset: new Uint16Array(n * 2),
        opacity: new Float32Array(n),
        selected: new Uint8Array(n),
        texIndex: new Int8Array(n),
        pos0Iterator: 0,
        pos1Iterator: 0,
        colorIterator: 0,
        widthIterator: 0,
        heightIterator: 0,
        offsetIterator: 0,
        opacityIterator: 0,
        selectedIterator: 0,
        texIndexIterator: 0,
    }
};

/**
 * Find the first and last non -1 tex indices from a list of cells
 **/

World.prototype.getTexIndices = function (cells) {
    // find the first non -1 tex index
    let f = 0;
    while (cells[f].texIdx === -1) f++;
    // find the last non -1 tex index
    let l = cells.length - 1;
    while (cells[l].texIdx === -1) l--;
    // return the first and last non -1 tex indices
    return {
        first: cells[f].texIdx,
        last: cells[l].texIdx,
    };
};

/**
 * Return textures from `obj.startIdx` to `obj.endIdx` indices
 **/

World.prototype.getTextures = function (obj) {
    let textures = [];
    for (let i = obj.startIdx; i <= obj.endIdx; i++) {
        let tex = this.getTexture(data.textures[i].canvas);
        textures.push(tex);
    }
    return textures;
};

/**
 * Transform a canvas object into a THREE texture
 **/

World.prototype.getTexture = function (canvas) {
    let tex = new THREE.Texture(canvas);
    tex.needsUpdate = true;
    tex.flipY = false;
    tex.generateMipmaps = false;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    return tex;
};

/**
 * Return an int specifying the scalar uniform for points
 **/

World.prototype.getPointScale = function () {
    let scalar = parseFloat(this.elems.pointSize.value),
        canvasSize = getCanvasSize();
    return scalar * window.devicePixelRatio * canvasSize.h;
};

/**
 * Build a RawShaderMaterial. For a list of all types, see:
 *   https://github.com/mrdoob/three.js/wiki/Uniforms-types
 *
 * @params:
 *   {obj}
 *     textures {arr}: array of textures to use in fragment shader
 *     useColor {bool}: determines whether to use color in frag shader
 *     firstTex {int}: the index position of the first texture in `textures`
 *       within data.textures
 **/

World.prototype.getShaderMaterial = function (obj) {
    let vertex = document.querySelector('#vertex-shader').textContent;
    let fragment = this.getFragmentShader(obj);
    // set the uniforms and the shaders to use
    return new THREE.RawShaderMaterial({
        uniforms: {
            textures: {
                type: 'tv',
                value: obj.textures,
            },
            lodTexture: {
                type: 't',
                value: lod.tex.texture,
            },
            transitionPercent: {
                type: 'f',
                value: 0,
            },
            scale: {
                type: 'f',
                value: this.getPointScale(),
            },
            scaleTarget: {
                type: 'f',
                value: this.getPointScale(),
            },
            useColor: {
                type: 'f',
                value: obj.useColor ? 1.0 : 0.0,
            },
            cellAtlasPxPerSide: {
                type: 'f',
                value: config.size.texture,
            },
            lodAtlasPxPerSide: {
                type: 'f',
                value: config.size.lodTexture,
            },
            cellPxHeight: {
                type: 'f',
                value: config.size.cell,
            },
            lodPxHeight: {
                type: 'f',
                value: config.size.lodCell,
            },
            borderWidth: {
                type: 'f',
                value: 0.15,
            },
            borderColor: {
                type: 'vec3',
                value: new Float32Array([234 / 255, 183 / 255, 85 / 255]),
            },
            delay: {
                type: 'f',
                value: config.transitions.delay,
            }
        },
        vertexShader: vertex,
        fragmentShader: fragment,
    });
};

// helper function to set uniforms on all meshes
World.prototype.setUniform = function (key, val) {
    let meshes = this.group.children.concat(picker.scene.children[0].children);
    for (let i = 0; i < meshes.length; i++) {
        meshes[i].material.uniforms[key].value = val;
    }
};

// helper function to distribute an array with length data.cells over draw calls
World.prototype.setBuffer = function (key, arr) {
    let drawCallToCells = world.getDrawCallToCells();
    for (let i in drawCallToCells) {
        let attr = world.group.children[i].geometry.attributes[key];
        let cells = drawCallToCells[i];
        attr.array = arr.slice(cells[0].idx, cells[cells.length - 1].idx + 1);
        attr.needsUpdate = true;
    }
};

/**
 * Return the color fragment shader or prepare and return
 * the texture fragment shader.
 *
 * @params:
 *   {obj}
 *     textures {arr}: array of textures to use in fragment shader
 *     useColor {float}: 0/1 determines whether to use color in frag shader
 *     firstTex {int}: the index position of the first texture in `textures`
 *       within data.textures
 **/

World.prototype.getFragmentShader = function (obj) {
    let useColor = obj.useColor,
        firstTex = obj.firstTex,
        textures = obj.textures,
        fragShader = document.querySelector('#fragment-shader').textContent;
    // the calling agent requested the color shader, used for selecting
    if (useColor) {
        fragShader = fragShader.replace('uniform sampler2D textures[N_TEXTURES];', '');
        fragShader = fragShader.replace('TEXTURE_LOOKUP_TREE', '');
        return fragShader;
        // the calling agent requested the textured shader
    } else {
        // get the texture lookup tree
        let tree = this.getFragLeaf(-1, 'lodTexture');
        for (let i = firstTex; i < firstTex + textures.length; i++) {
            tree += ' else ' + this.getFragLeaf(i, 'textures[' + i + ']');
        }
        // replace the text in the fragment shader
        fragShader = fragShader.replace('#define SELECTING\n', '');
        fragShader = fragShader.replace('N_TEXTURES', textures.length);
        fragShader = fragShader.replace('TEXTURE_LOOKUP_TREE', tree);
        return fragShader;
    }
};

/**
 * Get the leaf component of a texture lookup tree (whitespace is aesthetic)
 **/

World.prototype.getFragLeaf = function (texIdx, tex) {
    return 'if (textureIndex == ' + texIdx + ') {\n          ' +
        'gl_FragColor = texture2D(' + tex + ', scaledUv);\n        }';
};

/**
 * Set the needsUpdate flag to true on each attribute in `attrs`
 **/

World.prototype.attrsNeedUpdate = function (attrs) {
    this.group.children.forEach(function (mesh) {
        attrs.forEach(function (attr) {
            mesh.geometry.attributes[attr].needsUpdate = true;
        }.bind(this))
    }.bind(this))
};

/**
 * Conditionally display render stats
 **/

World.prototype.getStats = function () {
    if (!window.location.href.includes('stats=true')) return null;
    let stats = new Stats();
    stats.domElement.id = 'stats';
    stats.domElement.style.position = 'absolute';
    stats.domElement.style.top = '65px';
    stats.domElement.style.right = '5px';
    stats.domElement.style.left = 'initial';
    document.body.appendChild(stats.domElement);
    return stats;
};

/**
 * Fly the camera to a set of x,y,z coords
 **/

World.prototype.flyTo = function (obj) {
    if (this.state.flying) return;
    this.state.flying = true;
    // get a new camera to reset .up and .quaternion on this.camera
    let camera = this.getCamera(),
        controls = new THREE.TrackballControls(camera);
    camera.position.set(obj.x, obj.y, obj.z);
    controls.target.set(obj.x, obj.y, obj.z);
    controls.update();
    // prepare scope globals to transition camera
    let time = 0,
        q0 = this.camera.quaternion.clone();
    TweenLite.to(this.camera.position, config.transitions.duration, {
        x: obj.x,
        y: obj.y,
        z: obj.z,
        onUpdate: function () {
            time++;
            let deg = time / (config.transitions.duration * 60); // scale time 0:1
            THREE.Quaternion.slerp(q0, camera.quaternion, this.camera.quaternion, deg);
        }.bind(this),
        onComplete: function () {
            let q = camera.quaternion,
                p = camera.position,
                u = camera.up,
                c = controls.target,
                zMin = getMinCellZ();
            this.camera.position.set(p.x, p.y, p.z);
            this.camera.up.set(u.x, u.y, u.z);
            this.camera.quaternion.set(q.x, q.y, q.z, q.w);
            this.controls.target = new THREE.Vector3(c.x, c.y, zMin);
            this.controls.update();
            this.state.flying = false;
        }.bind(this),
        ease: obj.ease || Power4.easeInOut,
    });
};

// fly to the cell at index position `idx`
World.prototype.flyToCellIdx = function (idx) {
    let cell = data.cells[idx];
    world.flyTo({
        x: cell.x,
        y: cell.y,
        z: Math.min(
            config.pickerMaxZ - 0.0001,
            cell.z + (this.getPointScale() / 100)
        ),
    })
};

// fly to the cell at index position `idx`
World.prototype.flyToCellImage = function (img) {
    let idx = null;
    for (let i = 0; i < data.json.images.length; i++) {
        if (data.json.images[i] === img) idx = i;
    }
    if (!idx) return console.warn('The requested image could not be found');
    this.flyToCellIdx(idx);
};

/**
 * Get the initial camera location
 **/

World.prototype.getInitialLocation = function () {
    return {
        x: 0, //this.center.x,
        y: 0, //this.center.y,
        z: 2.0,
    }
};

/**
 * Initialize the render loop
 **/

World.prototype.render = function () {
    requestAnimationFrame(this.render.bind(this));
    if (!this.state.displayed) return;
    this.renderer.render(this.scene, this.camera);
    // update the controls
    this.controls.update();
    // update the stats
    if (this.stats) this.stats.update();
    // update the level of detail mechanism
    lod.update();
    // update the dragged lasso
    lasso.update();
};

/**
 * Initialize the plotting
 **/

World.prototype.init = function () {
    this.setCenter();
    // center the camera and position the controls
    let loc = this.getInitialLocation();
    this.camera.position.set(loc.x, loc.y, loc.z);
    this.camera.lookAt(loc.x, loc.y, loc.z);
    // draw the points and start the render loop
    this.plot();
    //resize the canvas and scale rendered assets
    this.handleResize();
    // initialize the first frame
    this.render();
    // set the mode
    this.setMode('pan');
    // set the display boolean
    world.state.displayed = true;
};

/**
 * Handle clicks that request a new mode
 **/

World.prototype.handleModeIconClick = function(e) {
    this.setMode(e.target.id);
};

/**
 * Show the user the tooltip explaining the select mode
 **/

World.prototype.showSelectTooltip = function() {
    let elem = document.querySelector('#select-tooltip');
    let button = document.querySelector('#select-tooltip-button');
    if (!localStorage.getItem('select-tooltip-cleared') ||
        localStorage.getItem('select-tooltip-cleared') == 'false') {
        elem.style.display = 'inline-block';
    }
    button.addEventListener('click', function() {
        localStorage.setItem('select-tooltip-cleared', true);
        elem.style.display = 'none';
        this.setMode('select');
    }.bind(this));
};

/**
 * Toggle the current world 'mode':
 *   'pan' means we're panning through x, y coords
 *   'select' means we're selecting cells to analyze
 **/

World.prototype.setMode = function(mode) {
    this.mode = mode;
    // update the ui buttons to match the selected mode
    let elems = document.querySelectorAll('#selection-icons img');
    for (let i=0; i<elems.length; i++) {
        elems[i].className = elems[i].id == mode ? 'active' : '';
    }
    // update internal state to reflect selected mode
    if (this.mode == 'pan') {
        this.controls.noPan = false;
        this.canvas.classList.remove('select');
        this.canvas.classList.add('pan');
        lasso.removeMesh();
        lasso.setFrozen(true);
        lasso.setEnabled(false);
    } else if (this.mode == 'select') {
        this.controls.noPan = true;
        this.canvas.classList.remove('pan');
        this.canvas.classList.add('select');
        lasso.setEnabled(true);
    }
};

/**
 * Lasso: polyline user-selections
 **/

function Lasso() {
    this.clock = new THREE.Clock(); // clock for animating polyline
    this.time = 0; // time counter for animating polyline
    this.points = []; // array of {x: y: } point objects tracing user polyline
    this.enabled = false; // boolean indicating if any actions on the lasso are permitted
    this.capturing = false; // boolean indicating if we're recording mousemoves
    this.frozen = false; // boolean indicating whether to listen to mouse events
    this.mesh = null; // the rendered polyline outlining user selection
    this.downloadFiletype = 'csv'; // filetype to use when downloading selection
    this.selected = {}; // d[cell idx] = bool indicating if selected
    this.displayed = false; // bool indicating whether the modal is displayed
    this.mousedownCoords = {}; // obj storing x, y, z coords of mousedown
    this.elems = {
        viewSelectedContainer: document.querySelector('#view-selected-container'),
        viewSelected: document.querySelector('#view-selected'),

        selectedImagesCount: document.querySelector('#selected-images-count'),
        countTarget: document.querySelector('#count-target'),
        xIcon: document.querySelector('#selected-images-x'),

        modalTarget: document.querySelector('#selected-images-target'),
        modalContainer: document.querySelector('#selected-images-modal'),
        modalTemplate: document.querySelector('#selected-images-template')
    }
    this.addMouseEventListeners();
    this.addModalEventListeners();
}

Lasso.prototype.addMouseEventListeners = function() {
    window.addEventListener('mousedown', function(e) {
        if (!this.enabled) return;
        if (!e.target.id || e.target.id != 'pixplot-canvas') return;
        if (!keyboard.shiftPressed() && !keyboard.commandPressed()) {
            this.points = [];
        }
        this.mousedownCoords = {x: e.clientX, y: e.clientY};
        this.setCapturing(true);
        this.setFrozen(false);
    }.bind(this));

    window.addEventListener('mousemove', function(e) {
        if (!this.capturing || this.frozen) return;
        if (!e.target.id || e.target.id != 'pixplot-canvas') return;
        this.points.push(getEventWorldCoords(e));
        this.draw();
    }.bind(this));

    window.addEventListener('mouseup', function(e) {
        if (!this.enabled) return;
        // prevent the lasso points from changing
        this.setFrozen(true);
        // if the user registered a click, clear the lasso
        if (e.clientX == this.mousedownCoords.x &&
            e.clientY == this.mousedownCoords.y &&
            !keyboard.shiftPressed() &&
            !keyboard.commandPressed()) {
            this.clear();
        }
        // do not turn off capturing if the user is clicking the lasso symbol
        if (!e.target.id || e.target.id == 'select') return;
        // prevent the lasso from updating its points boundary
        this.setCapturing(false);
    }.bind(this));
};

Lasso.prototype.addModalEventListeners = function() {
    // close the modal on click of wrapper
    this.elems.modalContainer.addEventListener('click', function(e) {
        if (e.target.className == 'modal-top') {
            this.elems.modalContainer.style.display = 'none';
            this.displayed = false;
        }
        if (e.target.className == 'background-image') {
            let index = e.target.getAttribute('data-index');
            let indices = [];
            Object.keys(this.selected).forEach(function(i, idx) {
                if (this.selected[i]) indices.push(idx);
            }.bind(this));
            pickerModal.showCells(indices, index);
        }
    }.bind(this));

    // show the list of images the user selected
    this.elems.viewSelected.addEventListener('click', function(e) {
        let images = Object.keys(this.selected).filter(function(k) {
            return this.selected[k];
        }.bind(this));
        let template = _.template(this.elems.modalTemplate.textContent)
        this.elems.modalTarget.innerHTML = template({ images: images });
        this.elems.modalContainer.style.display = 'block';
        this.displayed = true;
    }.bind(this));

    // toggle the inclusion of a cell in the selection
    this.elems.modalContainer.addEventListener('click', function(e) {
        if (e.target.className.includes('toggle-selection')) {
            e.preventDefault();
            let sibling = e.target.parentNode.querySelector('.background-image'),
                image = sibling.getAttribute('data-image');
            sibling.classList.contains('unselected')
                ? sibling.classList.remove('unselected')
                : sibling.classList.add('unselected');
            for (let i=0; i<data.json.images.length; i++) {
                if (data.json.images[i] == image) {
                    this.toggleSelection(i);
                    break;
                }
            }
        }
    }.bind(this));

    // allow users to clear the selected images
    this.elems.xIcon.addEventListener('click', this.clear.bind(this))
};

Lasso.prototype.update = function() {
    if (!this.enabled) return;
    if (this.mesh) {
        this.time += this.clock.getDelta() / 10;
        this.mesh.material.uniforms.time.value = this.time;
    }
};

Lasso.prototype.setEnabled = function(bool) {
    this.enabled = bool;
};

Lasso.prototype.setCapturing = function(bool) {
    this.capturing = bool;
};

Lasso.prototype.setFrozen = function(bool) {
    this.frozen = bool;
};

Lasso.prototype.clear = function() {
    this.setBorderedImages([]);
    this.removeMesh();
    this.elems.viewSelectedContainer.style.display = 'none';
    data.hotspots.setCreateHotspotVisibility(false);
    this.setCapturing(false);
    this.points = [];
};

Lasso.prototype.removeMesh = function() {
    if (this.mesh) world.scene.remove(this.mesh);
};

Lasso.prototype.setBorderedImages = function(indices) {
    let vals = new Uint8Array(data.cells.length);
    for (let i=0; i<indices.length; i++) vals[indices[i]] = 1;
    world.setBuffer('selected', vals);
};

Lasso.prototype.draw = function() {
    if (this.points.length <4) return;
    this.points = this.getHull();
    // remove the old mesh
    this.removeMesh();
    // get the indices of images that are inside the polygon
    this.selected = this.getSelected();
    let indices = [],
        keys = Object.keys(this.selected);
    for (let i=0; i<keys.length; i++) {
        if (this.selected[keys[i]]) indices.push(i)
    }
    // allow users to see the selected images if desired
    if (indices.length) {
        this.elems.viewSelectedContainer.style.display = 'block';
        data.hotspots.setCreateHotspotVisibility(true);
        this.elems.countTarget.textContent = indices.length;
    }
    // indicate the number of cells that are selected
    this.setNSelected(indices.length);
    // illuminate the points that are inside the polyline
    this.setBorderedImages(indices);
    // obtain and store a mesh, then add the mesh to the scene
    this.mesh = this.getMesh();
    world.scene.add(this.mesh);
};

// get a mesh that shows the polyline of selected points
Lasso.prototype.getMesh = function() {
    // create a list of 3d points to draw - the last point closes the loop
    let points = [];
    for (let i=0; i<this.points.length; i++) {
        let p = this.points[i];
        points.push(new THREE.Vector3(p.x, p.y, 0));
    }
    points.push(points[0]);
    // transform those points to a polyline
    let lengths = getCumulativeLengths(points);
    let geometry = new THREE.BufferGeometry().setFromPoints(points);
    let lengthAttr = new THREE.BufferAttribute(new Float32Array(lengths), 1);
    geometry.setAttribute('length', lengthAttr);
    let material = new THREE.RawShaderMaterial({
        uniforms: {
            time: { type: 'float', value: 0 },
            render: { type: 'bool', value: true }
        },
        vertexShader: document.querySelector('#dashed-vertex-shader').textContent,
        fragmentShader: document.querySelector('#dashed-fragment-shader').textContent
    });
    let mesh = new THREE.Line(geometry, material);
    mesh.frustumCulled = false;
    return mesh;
};

// get the convex hull of this.points
Lasso.prototype.getHull = function() {
    let graham = new ConvexHullGrahamScan();
    for (let i=0; i<this.points.length; i++) {
        graham.addPoint(this.points[i].x, this.points[i].y);
    }
    return graham.getHull();
};

Lasso.prototype.downloadSelected = function() {
    let images = Object.keys(this.selected).filter(function(k) {
        return this.selected[k]
    }.bind(this));
    // conditionally fetch the metadata for each selected image
    let rows = [];
    if (data.json.metadata) {
        for (let i=0; i<images.length; i++) {
            let metadata = {};
            get(config.data.dir + '/metadata/file/' + images[i] + '.json', function(data) {
                metadata[data.filename] = data;
                // if all metadata has loaded prepare data download
                if (Object.keys(metadata).length == images.length) {
                    let keys = Object.keys(metadata);
                    for (let i=0; i<keys.length; i++) { // TODO conflit avec le i en ligne 1588 ?
                        let m = metadata[keys[i]];
                        rows.push([
                            m.filename || '',
                            (m.tags || []).join('|'),
                            m.description,
                            m.permalink,
                        ])
                    }
                    this.downloadRows(rows);
                }
            }.bind(this));
        }
    } else {
        for (let i=0; i<images.length; i++) rows.push([images[i]]);
        this.downloadRows(rows);
    }
};

Lasso.prototype.downloadRows = function(rows) {
    let filetype = this.downloadFiletype;
    let filename = this.elems.downloadInput.value || Date.now().toString();
    if (!filename.endsWith('.' + filetype)) filename += '.' + filetype;
    downloadFile(rows, filename);
};

// return d[filename] = bool indicating selected
Lasso.prototype.getSelected = function() {
    let polygon = this.points.map(function(i) {
        return [i.x, i.y]
    });
    let selected = {};
    for (let i=0; i<data.json.images.length; i++) {
        let p = [data.cells[i].x, data.cells[i].y];
        selected[data.json.images[i]] = pointInPolygon(p, polygon);
    }
    return selected;
};

Lasso.prototype.toggleSelection = function(idx) {
    let image = data.json.images[idx];
    this.selected[image] = !this.selected[image];
    this.setNSelected();
};

Lasso.prototype.setNSelected = function(n) {
    let elem = document.querySelector('#n-images-selected');
    if (!elem) return;
    if (!Number.isInteger(n)) {
        n = 0; // TODO var n=0; est-ce que ça pose souci de ne pas redéclarer une variable ?
        let keys = Object.keys(this.selected);
        for (let i=0; i<keys.length; i++) {
            if (this.selected[keys[i]]) n++;
        }
    }
    elem.textContent = n;
};

/**
 * 2D convex hull via https://github.com/brian3kb/graham_scan_js
 **/

function ConvexHullGrahamScan() {
    this.anchorPoint = undefined;
    this.reverse = false;
    this.points = [];
}

ConvexHullGrahamScan.prototype = {
    constructor: ConvexHullGrahamScan,
    Point: function (x, y) {
        this.x = x;
        this.y = y;
    },
    _findPolarAngle: function (a, b) {
        let ONE_RADIAN = 57.295779513082;
        let deltaX, deltaY;
        // if the points are undefined, return a zero difference angle.
        if (!a || !b) return 0;
        deltaX = (b.x - a.x);
        deltaY = (b.y - a.y);
        if (deltaX == 0 && deltaY == 0) return 0;
        let angle = Math.atan2(deltaY, deltaX) * ONE_RADIAN;
        if (this.reverse) {
            if (angle <= 0) angle += 360;
        } else {
            if (angle >= 0) angle += 360;
        }
        return angle;
    },
    addPoint: function (x, y) {
        // check for a new anchor
        let newAnchor =
            ( this.anchorPoint === undefined ) ||
            ( this.anchorPoint.y > y ) ||
            ( this.anchorPoint.y === y && this.anchorPoint.x > x );
        if ( newAnchor ) {
            if ( this.anchorPoint !== undefined ) {
                this.points.push(new this.Point(this.anchorPoint.x, this.anchorPoint.y));
            }
            this.anchorPoint = new this.Point(x, y);
        } else {
            this.points.push(new this.Point(x, y));
        }
    },

    _sortPoints: function () {
        let self = this;
        return this.points.sort(function (a, b) {
            let polarA = self._findPolarAngle(self.anchorPoint, a);
            let polarB = self._findPolarAngle(self.anchorPoint, b);
            if (polarA < polarB) return -1;
            if (polarA > polarB) return 1;
            return 0;
        });
    },

    _checkPoints: function (p0, p1, p2) {
        let difAngle;
        let cwAngle = this._findPolarAngle(p0, p1);
        let ccwAngle = this._findPolarAngle(p0, p2);
        if (cwAngle > ccwAngle) {
            difAngle = cwAngle - ccwAngle;
            return !(difAngle > 180);
        } else if (cwAngle < ccwAngle) {
            difAngle = ccwAngle - cwAngle;
            return (difAngle > 180);
        }
        return true;
    },

    getHull: function () {
        let hullPoints = [],
            points,
            pointsLength;
        this.reverse = this.points.every(function(point) {
            return (point.x < 0 && point.y < 0);
        });
        points = this._sortPoints();
        pointsLength = points.length;
        // if there are less than 3 points, joining these points creates a correct hull.
        if (pointsLength < 3) {
            points.unshift(this.anchorPoint);
            return points;
        }
        // move first two points to output array
        hullPoints.push(points.shift(), points.shift());
        // scan is repeated until no concave points are present.
        while (true) {
            let p0,
                p1,
                p2;
            hullPoints.push(points.shift());
            p0 = hullPoints[hullPoints.length - 3];
            p1 = hullPoints[hullPoints.length - 2];
            p2 = hullPoints[hullPoints.length - 1];
            if (this._checkPoints(p0, p1, p2)) {
                hullPoints.splice(hullPoints.length - 2, 1);
            }
            if (points.length == 0) {
                if (pointsLength == hullPoints.length) {
                    // check for duplicate anchorPoint edge-case, if not found, add the anchorpoint as the first item.
                    let ap = this.anchorPoint;
                    // remove any udefined elements in the hullPoints array.
                    hullPoints = hullPoints.filter(function(p) { return !!p; });
                    if (!hullPoints.some(function(p) {
                        return (p.x == ap.x && p.y == ap.y);
                    })) {
                        hullPoints.unshift(this.anchorPoint);
                    }
                    return hullPoints;
                }
                points = hullPoints;
                pointsLength = points.length;
                hullPoints = [];
                hullPoints.push(points.shift(), points.shift());
            }
        }
    }
};

/**
 * Picker: Mouse event handler that uses gpu picking
 **/

function Picker() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.mouseDown = new THREE.Vector2();
    this.tex = this.getTexture();
}

// get the texture on which off-screen rendering will happen
Picker.prototype.getTexture = function () {
    let canvasSize = getCanvasSize();
    let tex = new THREE.WebGLRenderTarget(canvasSize.w, canvasSize.h);
    tex.texture.minFilter = THREE.LinearFilter;
    return tex;
};

// on canvas mousedown store the coords where user moused down
Picker.prototype.onMouseDown = function (e) {
    let click = this.getClickOffsets(e);
    this.mouseDown.x = click.x;
    this.mouseDown.y = click.y;
};

// get the x, y offsets of a click within the canvas
Picker.prototype.getClickOffsets = function (e) {
    let rect = e.target.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
    }
};

// on canvas click, show detailed modal with clicked image
Picker.prototype.onMouseUp = function (e) {
    // if click hit background, close the modal
    if (e.target.className === 'modal-top' ||
        e.target.className === 'modal-x') {
        return pickerModal.close();
    }
    // find the offset of the click event within the canvas
    let click = this.getClickOffsets(e);
    // if mouseup isn't in the last mouse position, user is dragging
    // if the click wasn't on the canvas, quit
    let cellIdx = this.select({x: click.x, y: click.y});
    if (click.x !== this.mouseDown.x ||
        click.y !== this.mouseDown.y || // m.down and m.up != means user is dragging
        cellIdx == -1 || // cellIdx == -1 means the user didn't click on a cell
        e.target.id !== 'pixplot-canvas') { // whether the click hit the gl canvas
        return;
    }
    // if we're in select mode, conditionally un/select the clicked cell
    if (world.mode == 'select') {
        if (keyboard.shiftPressed() || keyboard.commandPressed()) {
            return lasso.toggleSelection(cellIdx);
        }
    }
    // else we're in pan mode; zoom in if the camera is far away, else show the modal
    else if (world.mode == 'pan') {
        return world.camera.position.z > config.pickerMaxZ
            ? world.flyToCellIdx(cellIdx)
            : pickerModal.showCells([cellIdx]);
    }
};

// get the mesh in which to render picking elements
Picker.prototype.init = function () {
    world.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    document.body.addEventListener('mouseup', this.onMouseUp.bind(this));
    let group = new THREE.Group();
    for (let i = 0; i < world.group.children.length; i++) {
        let mesh = world.group.children[i].clone();
        mesh.material = world.getShaderMaterial({useColor: true});
        group.add(mesh);
    }
    this.scene.add(group);
};

// draw an offscreen world then reset the render target so world can update
Picker.prototype.render = function () {
    world.renderer.setRenderTarget(this.tex);
    world.renderer.render(this.scene, world.camera);
    world.renderer.setRenderTarget(null);
};

Picker.prototype.select = function (obj) {
    if (!world || !obj) return;
    this.render();
    // read the texture color at the current mouse pixel
    let pixelBuffer = new Uint8Array(4),
        x = obj.x * window.devicePixelRatio,
        y = this.tex.height - obj.y * window.devicePixelRatio;
    world.renderer.readRenderTargetPixels(this.tex, x, y, 1, 1, pixelBuffer);
    let id = (pixelBuffer[0] << 16) | (pixelBuffer[1] << 8) | (pixelBuffer[2]),
        cellIdx = id - 1; // ids use id+1 as the id of null selections is 0
    return cellIdx;
};

/**
 * Create a modal for larger image viewing
 **/

function PickerModal() {
    this.cellIdx = null;
    this.cellIndices = [];
}

PickerModal.prototype.showCells = function (cellIndices, cellIdx) {
    let self = this;
    self.cellIndices = Object.assign([], cellIndices);
    self.cellIdx = !isNaN(parseInt(cellIdx)) ? parseInt(cellIdx) : 0;
    // parse data attributes
    let filename = data.json.images[self.cellIndices[self.cellIdx]];
    let src = config.data.dir + '/originals/' + filename;

    // define function to show the modal
    function showModal(jsonInput) {
        let json = jsonInput || {};
        let template = document.querySelector('#selected-image-template').textContent;
        let target = document.querySelector('#selected-image-target');
        let templateData = {
            meta: Object.assign({}, json || {}, {
                src: src,
                filename: json.filename || filename,
            })
        };
        target.innerHTML = _.template(template)(templateData);
        target.style.display = 'block';
        // inject the loaded image into the DOM
        document.querySelector('#selected-image-parent').appendChild(json.image);
        tooltip.addTooltip({
            elem: document.querySelector('#mark-icon'),
            text: 'Add this avatar to the selection'
        });
    }

    // prepare the modal
    let image = new Image();
    image.id = 'selected-image';
    image.onload = function () {
        showModal({image: image});
        get(config.data.dir + '/metadata/file/' + filename + '.json', function (json) {
            showModal(Object.assign({}, json, {image: image}));
        });
    };
    image.src = src;
};

PickerModal.prototype.close = function () {
    window.location.href = '#';
    document.querySelector('#selected-image-target').style.display = 'none';
    this.cellIndices = [];
    this.cellIdx = null;
};

/**
 * Create a level-of-detail texture mechanism
 **/

function LOD() {
    let r = 1; // radius of grid to search for cells to activate
    this.tex = this.getCanvas(config.size.lodTexture); // lod high res texture
    this.cell = this.getCanvas(config.size.lodCell);
    this.cellIdxToImage = {}; // image cache mapping cell idx to loaded image data
    this.grid = {}; // set by this.indexCells()
    this.minZ = 0.8; // minimum zoom level to update textures
    this.initialRadius = r; // starting radius for LOD
    this.state = {
        openCoords: this.getAllTexCoords(), // array of unused x,y lod tex offsets
        camPos: {x: null, y: null}, // grid coords of current camera position
        neighborsRequested: 0,
        gridPosToCoords: {}, // map from a x.y grid position to cell indices and tex offsets at that grid position
        cellIdxToCoords: {}, // map from a cell idx to that cell's x, y offsets in lod texture
        cellsToActivate: [], // list of cells cached in this.cellIdxToImage and ready to be added to lod texture
        fetchQueue: [], // list of images that need to be fetched and cached
        radius: r, // current radius for LOD
        run: true, // bool indicating whether to use the lod mechanism
    };
}

/**
 * LOD Static Methods
 **/

LOD.prototype.getCanvas = function (size) {
    let canvas = getElem('canvas', {width: size, height: size, id: 'lod-canvas'});
    return {
        canvas: canvas,
        ctx: canvas.getContext('2d'),
        texture: world.getTexture(canvas),
    }
};

// create array of x,y texture offsets in lod texture open for writing
LOD.prototype.getAllTexCoords = function () {
    let coords = [];
    for (let y = 0; y < config.size.lodTexture / config.size.lodCell; y++) {
        for (let x = 0; x < config.size.lodTexture / config.size.lodCell; x++) {
            coords.push({x: x * config.size.lodCell, y: y * config.size.lodCell});
        }
    }
    return coords;
};

// add all cells to a quantized LOD grid
LOD.prototype.indexCells = function () {
    let coords = {};
    data.cells.forEach(function (cell) {
        cell.gridCoords = this.toGridCoords(cell);
        let x = cell.gridCoords.x,
            y = cell.gridCoords.y;
        if (!coords[x]) coords[x] = {};
        if (!coords[x][y]) coords[x][y] = [];
        coords[x][y].push(cell.idx);
    }.bind(this));
    this.grid = coords;
};

// given an object with {x, y, z} attributes, return the object's coords in grid
LOD.prototype.toGridCoords = function (pos) {
    let domain = data.boundingBox;
    // determine point's position as percent of each axis size 0:1
    let percent = {
        x: (pos.x - domain.x.min) / (domain.x.max - domain.x.min),
        y: (pos.y - domain.y.min) / (domain.y.max - domain.y.min),
    };
    // cut each axis into n buckets per axis and determine point's bucket indices
    let bucketSize = {
        x: 1 / Math.max(100, Math.ceil(data.json.images.length / 100)),
        y: 1 / Math.max(100, Math.ceil(data.json.images.length / 100)),
    };
    return {
        x: Math.floor(percent.x / bucketSize.x),
        y: Math.floor(percent.y / bucketSize.y),
    };
};

/**
 * LOD Dynamic Methods
 **/

// load high-res images nearest the camera; called every frame by world.render
LOD.prototype.update = function () {
    if (!this.state.run || world.state.flying || world.state.transitioning) return;
    this.updateGridPosition();
    this.fetchNextImage();
    world.camera.position.z < this.minZ
        ? this.addCellsToLodTexture()
        : this.clear();
};

LOD.prototype.updateGridPosition = function () {
    // determine the current grid position of the user / camera
    let camPos = this.toGridCoords(world.camera.position);
    // if the user is in a new grid position unload old images and load new
    if (this.state.camPos.x !== camPos.x || this.state.camPos.y !== camPos.y) {
        if (this.state.radius > 1) {
            this.state.radius = Math.ceil(this.state.radius * 0.6);
        }
        this.state.camPos = camPos;
        this.state.neighborsRequested = 0;
        this.unload();
        if (world.camera.position.z < this.minZ) {
            this.state.fetchQueue = getNested(this.grid, [camPos.x, camPos.y], []);
        }
    }
};

// if there's a fetchQueue, fetch the next image, else fetch neighbors
// nb: don't mutate fetchQueue, as that deletes items from this.grid
LOD.prototype.fetchNextImage = function () {
    // if the selection modal is displayed don't fetch additional images
    if (lasso.displayed) return;
    // identfiy the next image to be loaded
    let cellIdx = this.state.fetchQueue[0];
    this.state.fetchQueue = this.state.fetchQueue.slice(1);
    // if there was a cell index in the load queue, load that next image
    if (Number.isInteger(cellIdx)) {
        // if this image is in the cache
        if (this.cellIdxToImage[cellIdx]) {
            // if this image isn't already activated, add it to the list to activate
            if (!this.state.cellIdxToCoords[cellIdx]) {
                this.state.cellsToActivate = this.state.cellsToActivate.concat(cellIdx);
            }
            // this image isn't in the cache, so load and cache it
        } else {
            let image = new Image;
            image.onload = function (cellIdx) {
                this.cellIdxToImage[cellIdx] = image;
                if (!this.state.cellIdxToCoords[cellIdx]) {
                    this.state.cellsToActivate = this.state.cellsToActivate.concat(cellIdx);
                }
            }.bind(this, cellIdx);
            image.src = config.data.dir + '/thumbs/' + data.json.images[cellIdx];
        }
        // there was no image to fetch, so add neighbors to fetch queue if possible
    } else if (this.state.neighborsRequested < this.state.radius) {
        this.state.neighborsRequested = this.state.radius;
        for (let x = Math.floor(-this.state.radius * 1.5); x <= Math.ceil(this.state.radius * 1.5); x++) {
            for (let y = -this.state.radius; y <= this.state.radius; y++) {
                let coords = [this.state.camPos.x + x, this.state.camPos.y + y],
                    cellIndices = getNested(this.grid, coords, []).filter(function (cellIdx) {
                        return !this.state.cellIdxToCoords[cellIdx];
                    }.bind(this));
                this.state.fetchQueue = this.state.fetchQueue.concat(cellIndices);
            }
        }
        if (this.state.openCoords && this.state.radius < 30) {
            this.state.radius++;
        }
    }
};

/**
 * Add cells to LOD
 **/

// add each cell in cellsToActivate to the LOD texture
LOD.prototype.addCellsToLodTexture = function () {
    let textureNeedsUpdate = false;
    // find and store the coords where each img will be stored in lod texture
    for (let i = 0; i < this.state.cellsToActivate.length; i++) {
        let cellIdx = this.state.cellsToActivate[0],
            cell = data.cells[cellIdx];
        this.state.cellsToActivate = this.state.cellsToActivate.slice(1);
        // if cell is already loaded or is too far from camera quit
        if (this.state.cellIdxToCoords[cellIdx] || !this.inRadius(cell.gridCoords)) continue;
        // return if there are no open coordinates in the LOD texture
        let coords = this.state.openCoords[0];
        this.state.openCoords = this.state.openCoords.slice(1);
        // if (!coords), the LOD texture is full
        if (coords) {
            textureNeedsUpdate = true;
            // gridKey is a combination of the cell's x and y positions in the grid
            let gridKey = cell.gridCoords.x + '.' + cell.gridCoords.y;
            // initialize this grid key in the grid position to coords map
            if (!this.state.gridPosToCoords[gridKey]) this.state.gridPosToCoords[gridKey] = [];
            // add the cell data to the data stores
            this.state.gridPosToCoords[gridKey].push(Object.assign({}, coords, {cellIdx: cell.idx}));
            this.state.cellIdxToCoords[cell.idx] = coords;
            // draw the cell's image in a new canvas
            this.cell.ctx.clearRect(0, 0, config.size.lodCell, config.size.lodCell);
            this.cell.ctx.drawImage(this.cellIdxToImage[cell.idx], 0, 0);
            let tex = world.getTexture(this.cell.canvas);
            world.renderer.copyTextureToTexture(coords, tex, this.tex.texture);
            // activate the cell to update tex index and offsets
            cell.activate();
        }
    }
    // only update the texture and attributes if the lod tex changed
    if (textureNeedsUpdate) {
        world.attrsNeedUpdate(['textureIndex', 'offset']);
    }
};


LOD.prototype.inRadius = function (obj) {
    let xDelta = Math.floor(Math.abs(obj.x - this.state.camPos.x)),
        yDelta = Math.ceil(Math.abs(obj.y - this.state.camPos.y));
    // don't load the cell if it's too far from the camera
    return (xDelta <= (this.state.radius * 1.5)) && (yDelta < this.state.radius);
};

/**
 * Remove cells from LOD
 **/

// free up the high-res textures for images now distant from the camera
LOD.prototype.unload = function () {
    Object.keys(this.state.gridPosToCoords).forEach(function (gridPos) {
        let split = gridPos.split('.');
        if (!this.inRadius({x: parseInt(split[0]), y: parseInt(split[1])})) {
            this.unloadGridPos(gridPos);
        }
    }.bind(this));
};

LOD.prototype.unloadGridPos = function (gridPos) {
    // cache the texture coords for the grid key to be deleted
    let toUnload = this.state.gridPosToCoords[gridPos];
    // delete unloaded cell keys in the cellIdxToCoords map
    toUnload.forEach(function (coords) {
        try {
            // deactivate the cell to update buffers and free this cell's spot
            data.cells[coords.cellIdx].deactivate();
            delete this.state.cellIdxToCoords[coords.cellIdx];
        } catch (err) {
        }
    }.bind(this));
    // remove the old grid position from the list of active grid positions
    delete this.state.gridPosToCoords[gridPos];
    // free all cells previously assigned to the deleted grid position
    this.state.openCoords = this.state.openCoords.concat(toUnload);
};

// clear the LOD state entirely
LOD.prototype.clear = function () {
    Object.keys(this.state.gridPosToCoords).forEach(this.unloadGridPos.bind(this));
    this.state.camPos = {x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY};
    world.attrsNeedUpdate(['offset', 'textureIndex']);
    this.state.radius = this.initialRadius;
};

/**
 * Hotspots
 **/

function Hotspots() {
    this.json = {};
    this.mesh = null;
    this.nUserClusters = 0;
    this.elems = {
        createHotspot: document.querySelector('#create-hotspot'),
        saveHotspots: document.querySelector('#save-hotspots'),
        navInner: document.querySelector('#nav-inner'),
        template: document.querySelector('#hotspot-template'),
        target: document.querySelector('#hotspots'),
        nav: document.querySelector('nav')
    };

    get(getPath(data.json.custom_hotspots), this.handleJson.bind(this),
        function (err) {
            get(getPath(data.json.default_hotspots), this.handleJson.bind(this))
        }.bind(this)
    );
    this.addEventListeners();
}

Hotspots.prototype.handleJson = function (json) {
    this.json = json;
    this.render();
};

Hotspots.prototype.addEventListeners = function() {
    // add create hotspot event listener
    this.elems.createHotspot.addEventListener('click', function() {
        let img = null,
            nImages = 0,
            keys = Object.keys(lasso.selected);
        for (let i=0; i<keys.length; i++) {
            if (lasso.selected[keys[i]]) {
                nImages++;
                img = keys[i];
            }
        }
        // flatten the user's selection to a 2D array
        let hull = [];
        for (let i=0; i<lasso.points.length; i++) {
            hull.push([lasso.points[i].x, lasso.points[i].y])
        }
        // augment the hotspots data
        data.hotspots.json.push({
            convex_hull: hull,
            label: data.hotspots.getUserClusterName(),
            img: img,
            n_images: nImages,
        })
        data.hotspots.setCreateHotspotVisibility(false);
        data.hotspots.setSaveHotspotsVisibility(true);
        // render the hotspots
        data.hotspots.render();
        // scroll to the bottom of the hotspots
        setTimeout(function() {
            data.hotspots.scrollToBottom()
        }, 100);
    }.bind(this));
    // add save hotspots event listener
    this.elems.saveHotspots.addEventListener('click', function() {
        downloadFile(this.json, 'user_hotspots.json');
        this.setSaveHotspotsVisibility(false);
    }.bind(this));
}

Hotspots.prototype.render = function () {
    this.elems.target.innerHTML = _.template(this.elems.template.innerHTML)({
        hotspots: this.json,
        lassoEnabled: config.lassoEnabled
    });
    // render the hotspots
    let hotspots = document.querySelectorAll('.hotspot');
    for (let i = 0; i < hotspots.length; i++) {
        hotspots[i].querySelector('img').addEventListener('click', function (idx) {
            world.flyToCellImage(this.json[idx].img);
        }.bind(this, i));
        // show the convex hull of a cluster on mouse enter
        hotspots[i].addEventListener('mouseenter', function (idx) {
            let h = this.json[idx].convex_hull;
            if (!h) return;
            let shape = new THREE.Shape();
            shape.moveTo(h[0][0], h[0][1]);
            for (let i = 1; i < h.length; i++) shape.lineTo(h[i][0], h[i][1]);
            let geometry = new THREE.ShapeBufferGeometry(shape);
            let material = new THREE.MeshBasicMaterial({color: 0xffffff});
            material.transparent = true;
            material.opacity = 0.25;
            let mesh = new THREE.Mesh(geometry, material);
            mesh.position.z = -0.01;
            world.scene.add(mesh);
            this.mesh = mesh;
        }.bind(this, i));
        // remove the convex hull shape on mouseout
        hotspots[i].addEventListener('mouseleave', function (e) {
            world.scene.remove(this.mesh);
        }.bind(this));
        // allow users on localhost to delete hotspots
        let elem = hotspots[i].querySelector('.remove-hotspot-x');
        if (elem) {
            elem.addEventListener('click', function(i, e) {
                e.preventDefault();
                e.stopPropagation();
                data.hotspots.json.splice(i, 1);
                data.hotspots.setSaveHotspotsVisibility(true);
                data.hotspots.render();
                if (this.mesh) world.scene.remove(this.mesh);
            }.bind(this, i));
        }
        hotspots[i].querySelector('.hotspot-label').addEventListener('input', function (i, e) {
            data.hotspots.setSaveHotspotsVisibility(true);
            data.hotspots.json[i].label = hotspots[i].querySelector('.hotspot-label').textContent;
        }.bind(this, i));
    }
};

Hotspots.prototype.showHide = function () {
    this.elems.nav.className = ['umap'].indexOf(layout.selected) > -1
        ? ''
        : 'disabled'
};

Hotspots.prototype.scrollToBottom = function() {
    this.elems.navInner.scrollTo({
        top: this.elems.navInner.scrollHeight,
        behavior: 'smooth',
    });
};

Hotspots.prototype.getUserClusterName = function() {
    let alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let name = 'Cluster ' + alpha[this.nUserClusters++];
    if (this.nUserClusters.length >= alpha.length) {
        this.nUserClusters = 0;
    }
    return name;
};

Hotspots.prototype.setCreateHotspotVisibility = function(bool) {
    if (!config.lassoEnabled) return;
    this.elems.createHotspot.style.display = bool ? 'inline-block' : 'none';
};

Hotspots.prototype.setSaveHotspotsVisibility = function(bool) {
    if (!config.lassoEnabled) return;
    this.elems.saveHotspots.style.display = bool ? 'inline-block' : 'none';
};

/**
 * Assess WebGL parameters
 **/

function Webgl() {
    this.gl = this.getGl();
    this.limits = this.getLimits();
}

/**
 * Get a WebGL context, or display an error if WebGL is not available
 **/

Webgl.prototype.getGl = function () {
    let gl = getElem('canvas').getContext('webgl');
    if (!gl) document.querySelector('#webgl-not-available').style.display = 'block';
    return gl;
};

/**
 * Get the limits of the user's WebGL context
 **/

Webgl.prototype.getLimits = function () {
    // fetch all browser extensions as a map for O(1) lookups
    let extensions = this.gl.getSupportedExtensions().reduce(function (obj, i) {
        obj[i] = true;
        return obj;
    }, {});
    // assess support for 32-bit indices in gl.drawElements calls
    let maxIndex = 2 ** 16 - 1;
    ['', 'MOZ_', 'WEBKIT_'].forEach(function (ext) {
        if (extensions[ext + 'OES_element_index_uint']) maxIndex = 2 ** 32 - 1;
    });
    // for stats see e.g. https://webglstats.com/webgl/parameter/MAX_TEXTURE_SIZE
    return {
        // max h,w of textures in px
        textureSize: Math.min(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE), 2 ** 13),
        // max textures that can be used in fragment shader
        textureCount: this.gl.getParameter(this.gl.MAX_TEXTURE_IMAGE_UNITS),
        // max textures that can be used in vertex shader
        vShaderTextures: this.gl.getParameter(this.gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
        // max number of indexed elements
        indexedElements: maxIndex,
    }
};

/**
 * Keyboard
 **/

function Keyboard() {
    this.pressed = {};
    window.addEventListener('keydown', function(e) {
        this.pressed[e.keyCode] = true;
    }.bind(this))
    window.addEventListener('keyup', function(e) {
        this.pressed[e.keyCode] = false;
    }.bind(this))
}

Keyboard.prototype.shiftPressed = function() {
    return this.pressed[16];
};

Keyboard.prototype.commandPressed = function() {
    return this.pressed[91];
};

/**
 * Show/hide tooltips for user-facing controls
 **/

function Tooltip() {
    this.elem = document.querySelector('#tooltip');
    this.targets = [
        {
            elem: document.querySelector('#range-slider'),
            text: 'Adapt the size of the avatars',
        },
        {
            elem: document.querySelector('#chrono-start-stop'),
            text: 'Start/Stop timer',
        },
        {
            elem: document.querySelector('#chrono-reset'),
            text: 'Reset timer and list of selections',
        },
        {
            elem: document.querySelector('#chrono-done'),
            text: 'Stop timer and validate avatar selection',
        }
    ];
    this.targets.forEach(this.addTooltip.bind(this));
}

Tooltip.prototype.addTooltip = function (target) {
    target.elem.addEventListener('mouseenter', function (e) {
        let offsets = target.elem.getBoundingClientRect();
        this.elem.textContent = target.text;
        this.elem.style.position = 'absolute';
        this.elem.style.left = (offsets.left + target.elem.clientWidth - this.elem.clientWidth + 9) + 'px';
        this.elem.style.top = (offsets.top + target.elem.clientHeight + 16) + 'px';
    }.bind(this));
    target.elem.addEventListener('mouseout', function (e) {
        this.elem.style.top = '-10000px';
    }.bind(this))
};

/**
 * Handle load progress and welcome scene events
 **/

function Welcome() {
    this.progressElem = document.querySelector('#progress');
    this.buttonElem = document.querySelector('#enter-button');
    this.buttonElem.addEventListener('click', this.onButtonClick.bind(this));
}

Welcome.prototype.onButtonClick = function (e) {
    if (e.target.className.indexOf('active') > -1) {
        requestAnimationFrame(function () {
            this.removeLoader(function () {
                this.startWorld();
            }.bind(this));
        }.bind(this));
    }
};

Welcome.prototype.removeLoader = function (onSuccess) {
    let blocks = document.querySelectorAll('.block');
    for (let i = 0; i < blocks.length; i++) {
        setTimeout(function (i) {
            blocks[i].style.animation = 'exit 300s';
            setTimeout(function (i) {
                blocks[i].parentNode.removeChild(blocks[i]);
                if (i === blocks.length - 1) onSuccess();
            }.bind(this, i), 1000)
        }.bind(this, i), i * 100)
    }
    document.querySelector('#progress').style.opacity = 0;
};

Welcome.prototype.updateProgress = function () {
    let progress = valueSum(data.textureProgress) / data.textureCount;
    // remove the decimal value from the load progress
    progress = progress.toString();
    let index = progress.indexOf('.');
    if (index > -1) progress = progress.substring(0, index);
    // display the load progress
    this.progressElem.textContent = progress + '%';
    if (progress === "100" &&
        data.loadedTextures === data.textureCount &&
        world.heightmap) {
        this.buttonElem.className += ' active';
    }
};

Welcome.prototype.startWorld = function () {
    requestAnimationFrame(function () {
        world.init();
        picker.init();
        setTimeout(function () {
            requestAnimationFrame(function () {
                document.querySelector('#loader-scene').classList += 'hidden';
                document.querySelector('#header-controls').style.opacity = 1;
            })
        }, 1500)
    }.bind(this))
};

/**
 * Make an XHR get request for data
 *
 * @param {string} url: the url of the data to fetch
 * @param {function} onSuccess: onSuccess callback function
 * @param {function} onErr: onError callback function
 **/

function get(url, onSuccess, onErr) {
    onSuccess = onSuccess || function () {
    };
    onErr = onErr || function () {
    };
    let xhr = new XMLHttpRequest();
    xhr.overrideMimeType('text\/plain; charset=x-user-defined');
    xhr.onreadystatechange = function () {
        if (xhr.readyState === XMLHttpRequest.DONE) {
            if (xhr.status === 200) {
                let data = xhr.responseText;
                // unzip the data if necessary
                if (url.substring(url.length - 3) === '.gz') {
                    data = gunzip(data);
                    url = url.substring(0, url.length - 3);
                }
                // determine if data can be JSON parsed
                url.substring(url.length - 5) === '.json'
                    ? onSuccess(JSON.parse(data))
                    : onSuccess(data);
            } else {
                onErr(xhr)
            }
        }
    };
    xhr.open('GET', url, true);
    xhr.send();
}

// extract content from gzipped bytes
function gunzip(data) {
    let bytes = [];
    for (let i = 0; i < data.length; i++) {
        bytes.push(data.charCodeAt(i) & 0xff);
    }
    let gunzip = new Zlib.Gunzip(bytes);
    let plain = gunzip.decompress();
    // Create ascii string from byte sequence
    let asciistring = '';
    for (let i = 0; i < plain.length; i++) {
        asciistring += String.fromCharCode(plain[i]);
    }
    return asciistring;
}

/**
 * Download a file to user's downloads
 **/

function downloadFile(data, filename) {
    let filenameParts = filename.split('.');
    let filetype = filenameParts[filenameParts.length-1]; // 'csv' || 'json'
    let blob = filetype == 'json'
        ? new Blob([JSON.stringify(data)], {type: 'octet/stream'})
        : new Blob([Papa.unparse(data)], {type: 'text/plain'});
    let a = document.createElement('a');
    document.body.appendChild(a);
    a.download = filename;
    a.href = window.URL.createObjectURL(blob);
    a.click();
    a.parentNode.removeChild(a);
}

/**
 * Find the smallest z value among all cells
 **/

function getMinCellZ() {
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < data.cells.length; i++) {
        min = Math.min(data.cells[i].z, min);
    }
    return min;
}

/**
 * Create an element
 *
 * @param {object} objInput: a set of k/v attributes to be applied to the element
 * @param {string} tag: specifies the tag to use for the element
 **/

function getElem(tag, objInput) {
    let obj = objInput || {};
    let elem = document.createElement(tag);
    Object.keys(obj).forEach(function (attr) {
        elem[attr] = obj[attr];
    });
    return elem;
}

/**
 * Find the sum of values in an object
 **/

function valueSum(obj) {
    return Object.keys(obj).reduce(function (a, b) {
        a += obj[b];
        return a;
    }, 0)
}

/**
 * Get the value assigned to a nested key in a dict
 **/

function getNested(obj, keyArr, ifEmpty) {
    let result = keyArr.reduce(function (o, key) {
        return o[key] ? o[key] : {};
    }, obj);
    return result.length ? result : ifEmpty;
}

/**
 * Get the H,W of the canvas to use for rendering
 **/

function getCanvasSize() {
    let elem = document.querySelector('#pixplot-canvas');
    return {
        w: elem.clientWidth,
        h: elem.clientHeight,
    }
}

/**
 * Get the user's current url route
 **/

function getPath(path) {
    let base = window.location.origin;
    base += window.location.pathname.replace('index.html', '');
    base += path.replace('output/', '');
    return base;
}

/**
 * Scale each dimension of an array -1:1
 **/

function scale(arr) {
    let max = Number.POSITIVE_INFINITY,
        min = Number.NEGATIVE_INFINITY,
        domX = {min: max, max: min},
        domY = {min: max, max: min},
        domZ = {min: max, max: min};
    // find the min, max of each dimension
    for (let i = 0; i < arr.length; i++) {
        let x = arr[i][0],
            y = arr[i][1],
            z = arr[i][2] || 0;
        if (x < domX.min) domX.min = x;
        if (x > domX.max) domX.max = x;
        if (y < domY.min) domY.min = y;
        if (y > domY.max) domY.max = y;
        if (z < domZ.min) domZ.min = z;
        if (z > domZ.max) domZ.max = z;
    }
    let centered = [];
    for (let i = 0; i < arr.length; i++) {
        let cx = (((arr[i][0] - domX.min) / (domX.max - domX.min)) * 2) - 1,
            cy = (((arr[i][1] - domY.min) / (domY.max - domY.min)) * 2) - 1,
            cz = (((arr[i][2] - domZ.min) / (domZ.max - domZ.min)) * 2) - 1 || null;
        if (arr[i].length === 3) centered.push([cx, cy, cz]);
        else centered.push([cx, cy]);
    }
    return centered;
}

/**
 * Geometry helpers
 **/

// convert a flat object to a 1D array
function arrayify(obj) {
    let keys = Object.keys(obj);
    let l = [];
    for (let i = 0; i < keys.length; i++) {
        l.push(obj[keys[i]]);
    }
    return l;
}

// compute the magnitude of a vector
function magnitude(vec) {
    let v = 0;
    if (Array.isArray(vec)) {
        for (let i = 0; i < vec.length; i++) {
            v += vec[i] ** 2;
        }
        return v ** (1 / 2);
    } else if (typeof vec === 'object') {
        return magnitude(arrayify(vec));
    } else {
        throw Error('magnitude requires an array or object')
    }
}

// compute the dot product of two vectors
function dotProduct(a, b) {
    if (typeof a === 'object' && !Array.isArray(a)) a = arrayify(a);
    if (typeof b === 'object' && !Array.isArray(b)) b = arrayify(b);
    if (a.length !== b.length) throw Error('dotProduct requires vecs of same length');
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
}

function rad2deg(radians) {
    return radians * (180 / Math.PI);
}

// compute the theta between two points
function theta(a, b) {
    let num = dotProduct(a, b);
    let denom = magnitude(a) * magnitude(b);
    let radians = denom === 0
        ? 0
        : Math.acos(num / denom);
    return radians
        ? rad2deg(radians)
        : 0;
}

// find the cumulative length of the line up to each point
function getCumulativeLengths(points) {
    let lengths = [];
    let sum = 0;
    for (let i=0; i<points.length; i++) {
        if (i>0) sum += points[i].distanceTo(points[i - 1]);
        lengths[i] = sum;
    }
    return lengths;
}

// via https://github.com/substack/point-in-polygon
function pointInPolygon(point, polygon) {
    let x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        let xi = polygon[i][0], yi = polygon[i][1];
        let xj = polygon[j][0], yj = polygon[j][1];
        let intersect = ((yi > y) != (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * Coordinate conversions
 **/

function getEventWorldCoords(e) {
    let rect = e.target.getBoundingClientRect(),
        dx = e.clientX - rect.left,
        dy = e.clientY - rect.top;
    return screenToWorldCoords({x: dx, y: dy});
}

function screenToWorldCoords(pos) {
    let vector = new THREE.Vector3(),
        camera = world.camera,
        canvasSize = getCanvasSize(),
        // convert from screen to clip space
        x = (pos.x / canvasSize.w) * 2 - 1,
        y = -(pos.y / canvasSize.h) * 2 + 1;
    // project the screen location into world coords
    vector.set(x, y, 0.5);
    vector.unproject(camera);
    let direction = vector.sub(camera.position).normalize(),
        distance = - camera.position.z / direction.z,
        scaled = direction.multiplyScalar(distance),
        coords = camera.position.clone().add(scaled);
    return coords;
}

/**
 * Selections
 **/

function Selections() {
    this.images = [];
    this.elems = {
        asideInner: document.querySelector('#aside-inner'),
        template: document.querySelector('#selection-template'),
        target: document.querySelector('#selections')
    };
}

Selections.prototype.markImage = function (name) {
    if (this.images.map(function (elt) {
        return elt.name;
    }).includes(name)) {
        alert("This image is already in your list of selections");
        return;
    }

    // add the new image to the selections data
    this.images.push({
        name: name,
        label: (name + "").replace(".png", "")
    });
    // render the selections
    this.render();
    // scroll to the bottom of the selections
    setTimeout(function () {
        selections.scrollToBottom()
    }, 100);
};

Selections.prototype.clear = function () {
    this.images = [];
    this.render();
};

Selections.prototype.render = function () {
    this.elems.target.innerHTML = _.template(this.elems.template.innerHTML)({
        selections: this.images
    });

    // render the selections
    let selections = document.querySelectorAll('.selection');
    for (let i = 0; i < selections.length; i++) {
        selections[i].querySelector('img').addEventListener('click', function (idx) {
            world.flyToCellImage(this.images[idx].name);
        }.bind(this, i));
    }
};

Selections.prototype.scrollToBottom = function () {
    this.elems.asideInner.scrollTo({
        top: this.elems.asideInner.scrollHeight,
        behavior: 'smooth',
    });
};

/**
 * Chrono
 **/

function Chrono() {
    this.startTime = 0;
    this.endTime = 0;
    this.diff = 0;
    this.timerID = 0;

    this.elems = {
        time: document.getElementById("chrono-time"),
        startStopButton: document.getElementById("chrono-start-stop"),
        resetButton: document.getElementById("chrono-reset"),
        doneButton: document.getElementById("chrono-done"),

        modalChoiceTarget: document.querySelector('#final-choice-images-target'),
        modalChoiceContainer: document.querySelector('#final-choice-images-modal'),
        modalChoiceTemplate: document.querySelector('#final-choice-images-template'),

        modalResultTarget: document.querySelector('#result-target'),
        modalResultContainer: document.querySelector('#result-modal'),
        modalResultTemplate: document.querySelector('#result-template'),
    };
    this.result = {};


    // close the result modal on click of wrapper
    this.elems.modalResultContainer.addEventListener('click', function (e) {
        if (e.target.className === 'modal-top') {
            this.elems.modalResultContainer.style.display = 'none';
        }
    }.bind(this));

    this.elems.modalChoiceContainer.addEventListener('click', function (e) {
        // close the choice modal on click of wrapper
        if (e.target.className === 'modal-top') {
            this.elems.modalChoiceContainer.style.display = 'none';
        }

        // save the results
        if (e.target.className === 'background-image') {
            this.result.timestamp = new Date().getTime();
            this.result.chrono = this.elems.time.innerText;
            this.result.images = selections.images.map(function (img) {
                return img.name;
            });
            this.result.choice = e.target.getAttribute('data-image');

            this.getAjax(JSON.stringify(this.result),
                function (data) {
                    this.result.save = {httpStatus: 200, id: data};
                    this.displayResultModal(this.result);
                    this.stopReset();
                }.bind(this),
                function () {
                    this.result.save = {httpStatus: 400};
                    this.displayResultModal(this.result);
                }.bind(this)
            );
        }
    }.bind(this));
}

Chrono.prototype.getAjax = function (data, success, failure) {
    let xhr = window.XMLHttpRequest ? new XMLHttpRequest() : new ActiveXObject('Microsoft.XMLHTTP');
    xhr.open('GET', "php/results.php?result=" + data); // TODO adapt this URL depending on the installation
    xhr.onreadystatechange = function () {
        if (xhr.readyState > 3 && xhr.status === 200) {
            success(xhr.responseText);
        } else {
            failure();
        }
    };
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.send();
    return xhr;
};

Chrono.prototype.run = function () {
    this.endTime = new Date();
    this.diff = new Date(this.endTime - this.startTime);
    let sec = this.diff.getSeconds();
    let min = this.diff.getMinutes();
    let hr = this.endTime.getHours() - this.startTime.getHours();

    if (min < 10) {
        min = "0" + min;
    }
    if (sec < 10) {
        sec = "0" + sec;
    }
    this.elems.time.innerHTML = hr + ":" + min + ":" + sec;
    this.timerID = setTimeout("chrono.run()", 10);
};

Chrono.prototype.start = function () {
    this.elems.startStopButton.innerHTML = '<i class="fas fa-pause-circle"></i>';
    this.elems.startStopButton.onclick = this.stop.bind(this);
    this.elems.resetButton.onclick = this.reset.bind(this);
    this.startTime = new Date();
    selections.clear();
    this.run();
};

Chrono.prototype.continue = function () {
    this.elems.startStopButton.innerHTML = '<i class="fas fa-pause-circle"></i>';
    this.elems.startStopButton.onclick = this.stop.bind(this);
    this.elems.resetButton.onclick = this.reset.bind(this);
    this.startTime = new Date() - this.diff;
    this.startTime = new Date(this.startTime);
    this.run();
};

Chrono.prototype.reset = function () {
    this.elems.time.innerHTML = "0:00:00";
    this.startTime = new Date();
    selections.clear();
};

Chrono.prototype.stopReset = function () {
    this.reset();
    this.elems.startStopButton.onclick = this.start.bind(this);
};

Chrono.prototype.stop = function () {
    this.elems.startStopButton.innerHTML = '<i class="fas fa-play-circle"></i>';
    this.elems.startStopButton.onclick = this.continue.bind(this);
    this.elems.resetButton.onclick = this.stopReset.bind(this);
    clearTimeout(this.timerID);
};

Chrono.prototype.doneDisplay = function () {
    this.stop();
    let images = selections.images;
    let template = _.template(this.elems.modalChoiceTemplate.textContent);
    this.elems.modalChoiceTarget.innerHTML = template({images: images});
    this.elems.modalChoiceContainer.style.display = 'block';
};

Chrono.prototype.displayResultModal = function (result) {
    let template = _.template(this.elems.modalResultTemplate.textContent);
    this.elems.modalResultTarget.innerHTML = template({result: result});

    this.elems.modalChoiceContainer.style.display = 'none';
    this.elems.modalResultContainer.style.display = 'block';
};


/**
 * ManualZoom
 **/

function ManualZoom() {
    this.elems = {
        zoomInButton: document.querySelector('#zoom-in-button'),
        zoomOutButton: document.querySelector('#zoom-out-button'),
        enableManualZoomButton: document.querySelector('#enable-manual-zoom-input'),

        manualZoom: document.querySelector('#manual-zoom')
    };

    // initialize the eventListeners
    this.addEventListeners();
}

ManualZoom.prototype.addEventListeners = function () {
    this.elems.zoomInButton.addEventListener('click', this.simulateMousewheel.bind(this, -3), false);
    this.elems.zoomOutButton.addEventListener('click', this.simulateMousewheel.bind(this, +3), false);
    this.elems.enableManualZoomButton.addEventListener('click', this.switchDisplay.bind(this), false);
};

/**
 * Display or hide the [+] and [-] buttons at the bottom right of the map
 */
ManualZoom.prototype.switchDisplay = function () {
    if (this.elems.enableManualZoomButton.checked) {
        this.elems.manualZoom.style.display = 'inline-block';
    } else {
        this.elems.manualZoom.style.display = 'none';
    }
};

/**
 * This method simulates the scroll with the mousewheel (which triggers the zoomIn/zoomOut event in the map)
 * @param delta Value deltaY of the WheelEvent (zoomIn : delta < 0 ; zoomOut : delta > 0)
 */
ManualZoom.prototype.simulateMousewheel = function (delta) {
    let evt = new WheelEvent("wheel",
        {
            bubbles: true,
            deltaY: delta,
            deltaMode: 1,
            clientX: world.controls.screen.left + world.controls.screen.width / 2,
            clientY: world.controls.screen.top + world.controls.screen.height / 2
        });
    world.controls.domElement.dispatchEvent(evt);
};


/**
 * Main
 **/

window.location.href = '#';
window.devicePixelRatio = Math.min(window.devicePixelRatio, 2);
var welcome = new Welcome();
var webgl = new Webgl();
var config = new Config();
var picker = new Picker(); // used to handle the user's click in the canvas
var pickerModal = new PickerModal(); // used to display the modal to add an image to the selection
var keyboard = new Keyboard();
var lasso = new Lasso();
var layout = new Layout();
var world = new World();
var lod = new LOD();
var tooltip = new Tooltip(); // used to display the tooltips
var data = new Data();
var selections = new Selections(); // used to manage the user's selections
var chrono = new Chrono(); // used to manage the chrono
var manualZoom = new ManualZoom(); // used for the manual zoom
