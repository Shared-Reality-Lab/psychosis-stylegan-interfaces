/**
 * Show/hide tooltips for user-facing controls
 **/

function Tooltip() {
    this.elem = document.querySelector('#tooltip');
    this.targets = [
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
 * Target upload
 */
var loadImage = function(event) {
	var image = document.getElementById('target-image');
	image.src = URL.createObjectURL(event.target.files[0]);
};

/**
 * Detail slider value
 */
$(document).ready(function() {

    const $grainLevel = $('#grain-level');
    const $value = $('#range-grain');
    $grainLevel.html($value.val());
    $value.on('input change', () => {
  
      $grainLevel.html($value.val());
    });
  });

/**
* Generate random image and update current selection
*/
$("#rndImage").click(function(){
	$('.spinner-border').show();
	$("#system-status").text('STATUS: PROCESSING');
	$.ajax({url: "/rndIm",
		success: updateSelection
	});
});

function updateSelection(result){
	var filename = result.filename.concat("?nocache=",Date.now().toString());
//	console.log(filename);
	$("#system-status").text('STATUS: SUCCESS');
	$('.spinner-border').hide();
	$("#avatar-image").attr('src', filename);
}

/**
* Warm starting, get seed number and send it to the server
*/
$("#warmStarting").click(function(){
	$("#warm-starting-modal").show();
});

$("#warm-starting-form").click(function(){
	var seed = $("#warm-starting-input").val();
	seed = parseInt(seed);
	$("#warm-starting-modal").hide();
	$("#system-status").text('STATUS: PROCESSING');
	$('.spinner-border').show();
	$.ajax({
		type: "POST",
		url: "/warmStarting",
		data: JSON.stringify({
			"seed": seed
		}),
		dataType: "json",
                contentType: "application/json",
                success: updateSelection,
	});
});

/**
* Get user input and request output to the server
*/
$(".attrControl").click(function(){
	// build the data with grain level, attribute to manipulate and direction (+ or -)
	$("#system-status").text('STATUS: PROCESSING');
	$('.spinner-border').show();
	var grainLevel = $('#range-grain').val();
	var id = $(this).attr('id');
	var direction = id.split("_")[1];
	var attribute = id.split("_")[0];
	$.ajax({
		type: "POST",
		url: "/generate",
		data: JSON.stringify({"grain": grainLevel,
			"attribute": attribute,
			"direction": direction}),
		dataType: "json",
		contentType: "application/json",
		success: updateSelection,
	});
});

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
    
	modalIdContainer: document.querySelector('#user-id-modal'),
	modalIdForm: document.querySelector('#user-id-form'),
	modalIdInput: document.querySelector('#user-id-input'),
    	
	modalErrorContainer: document.querySelector('#error-id-modal'),
	modalErrorLog: document.querySelector('#error-id-log'),
	modalSuccessContainer: document.querySelector('#success-modal'),
	modalSuccessLog: document.querySelector('#success-log'),
    };
    this.result = {};

    // close the id modal on click of submit
    this.elems.modalIdForm.addEventListener('click', function(e){
	this.elems.modalIdContainer.style.display = 'none';
	var user_id = $("#user-id-input").val();
	$("#system-status").text('STATUS: PROCESSING');
        $('.spinner-border').show();
	$.ajax({
        	type: "POST",
        	url: "/startCustomization",
        	data: JSON.stringify({"id" : user_id}),
        	dataType: "json",
        	contentType: "application/json",
        	success: function(data){
			if (data['status'] == 'error'){
				$("#system-status").text('STATUS: ERROR');
        			$('.spinner-border').hide();
				this.elems.modalErrorContainer.style.display = 'block';
				this.elems.modalErrorLog.textContent = data['error_log'];
				this.stop();
				this.stopReset();
			}
			else{
				this.elems.modalErrorContainer.style.display = 'none';
				updateSelection(data)
			}
		}.bind(this),
        });

    }.bind(this));
}

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
    this.elems.modalIdContainer.style.display = 'block';
    this.elems.modalSuccessContainer.style.display = 'none';
    this.elems.modalErrorContainer.style.display = 'none';
    $("#avatar-image").attr('src', '/static/empty.png');
    $("#target-image").attr('src', '/static/empty.png');
    $('#rndImage').prop('disabled', false);
    $("input[name='options']").prop('disabled', false);
    $('#prev-btn').prop('disabled', false);
    $('#next-btn').prop('disabled', false);
    $('#warmStarting').prop('disabled',false);
    this.run();
};

Chrono.prototype.continue = function () {
    this.elems.startStopButton.innerHTML = '<i class="fas fa-pause-circle"></i>';
    this.elems.startStopButton.onclick = this.stop.bind(this);
    this.elems.resetButton.onclick = this.reset.bind(this);
    this.startTime = new Date() - this.diff;
    this.startTime = new Date(this.startTime);
    $('#rndImage').prop('disabled', false);
    $("input[name='options']").prop('disabled', false);
    $('#prev-btn').prop('disabled', false);
    $('#next-btn').prop('disabled', false);
    $('#warmStarting').prop('disabled',false);
    this.run();
};

Chrono.prototype.reset = function () {
    this.elems.time.innerHTML = "0:00:00";
    this.startTime = new Date();
    $("#avatar-image").attr('src', '/static/empty.png');
    $("#target-image").attr('src', '/static/empty.png');
    this.elems.modalSuccessContainer.style.display = 'none';
};

Chrono.prototype.stopReset = function () {
    this.reset();
    this.elems.startStopButton.onclick = this.start.bind(this);
};

Chrono.prototype.stop = function () {
    this.elems.startStopButton.innerHTML = '<i class="fas fa-play-circle"></i>';
    this.elems.startStopButton.onclick = this.continue.bind(this);
    this.elems.resetButton.onclick = this.stopReset.bind(this);
    $('#rndImage').prop('disabled', true);
    $("input[name='options']").prop('disabled', true);
    $('#prev-btn').prop('disabled', true);
    $('#next-btn').prop('disabled', true);
    $('#warmStarting').prop('disabled',true);
    clearTimeout(this.timerID);
};

Chrono.prototype.done = function () {
    this.stop();
    this.result.timestamp = new Date().getTime();
    this.result.chrono = this.elems.time.innerText;
    this.result.image = $("#avatar-image").attr('src')
    $.ajax({
	type: "POST",
	url: "/passOver",        
	data: JSON.stringify(this.result),
	dataType: "json",       
	contentType: "application/json",
   	success: function(data){
		if (data['status'] == 'error'){
                	this.elems.modalErrorContainer.style.display = 'block';
                        this.elems.modalErrorLog.textContent = data['error_log'];
                }
                else{
                        this.elems.modalErrorContainer.style.display = 'none';
                	this.elems.modalSuccessContainer.style.display = 'block';
			this.elems.modalSuccessLog.textContent = data['success_log'];
		}
	}.bind(this),
    });
    this.stopReset();
};

/*
* Previous/Next option
*/
$('#prev-btn').click(function(){
	$.ajax({
                type: "GET",
                url: "/previous",
                success: updateSelection,
        });
});

$('#next-btn').click(function(){
	$.ajax({
                type: "GET",
                url: "/next",
                success: updateSelection,
        });
});


/*
* Disabling buttons when outside of session to prevent crashes
*/
window.onload = function(){
	console.log("loaded page");
	$('#rndImage').prop('disabled', true);
	$("input[name='options']").prop('disabled', true);
	$('#prev-btn').prop('disabled', true);
	$('#next-btn').prop('disabled', true);
	$('#warmStarting').prop('disabled',true);
};
var chrono = new Chrono(); // used to manage the chrono
var tooltip = new Tooltip(); // used to display the tooltips

