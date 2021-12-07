/**
 * Target upload
 */
var loadImage = function(event) {
	var image = document.getElementById('target-image');
	image.src = URL.createObjectURL(event.target.files[0]);
};

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
            text: 'Reset timer and avatars',
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
        
        modalWarmStartingContainer: document.querySelector('#warm-starting-modal'),
        modalWarmStartingTemplate: document.querySelector('#warm-starting-template'),
        modalWarmStartingTarget: document.querySelector('#warm-starting-target'),
    };
    this.result = {};

    // close the id modal on click of submit
    this.elems.modalIdForm.addEventListener('click', function(e){
	this.elems.modalIdContainer.style.display = 'none';
	var user_id = $("#user-id-input").val(); 
    
    $.ajax({
        	type: "POST",
        	url: "/warmStarting",
        	data: JSON.stringify({"id" : user_id}),
        	dataType: "json",
        	contentType: "application/json",
        	success: function(data){
			if (data['status'] == 'error'){
				this.elems.modalErrorContainer.style.display = 'block';
				this.elems.modalErrorLog.textContent = data['error_log'];
				this.stop();
				this.stopReset();
			}
			else{
				this.elems.modalErrorContainer.style.display = 'none';
       				var images = [];
				$.getJSON('/static/hotspots.json',function(data){
           				$.each(data, function(key, val){
               					images.push({
                   					name : val
               					});
           				});
           				let template = _.template(this.elems.modalWarmStartingTemplate.textContent);
           				this.elems.modalWarmStartingTarget.innerHTML = template({images: images});
       				}.bind(this));
       				this.elems.modalWarmStartingContainer.style.display = 'block';
			}
		}.bind(this),
        });
    }.bind(this));

    this.elems.modalWarmStartingContainer.addEventListener('click',function(e){
        if (e.target.className === 'background-image') {
            this.result.initial_point = e.target.getAttribute('data-image');
            $('.spinner-border').css('display', 'inline-block');
	    $.ajax({
                type: "POST",
                url: "/startCustomization",
                data: JSON.stringify({"initial_point" : this.result.initial_point}),
                dataType: "json",
                contentType: "application/json",
                success: function(data){
                    if (data['status'] == 'error'){
                        this.elems.modalErrorContainer.style.display = 'block';
                        this.elems.modalErrorLog.textContent = data['error_log'];
			$("#status").text("Status: ERROR");
			$('.spinner-border').css('display','none');
                        this.stop();
                        this.stopReset();
                    }
                    else{
                        this.elems.modalErrorContainer.style.display = 'none';
                    	this.elems.modalWarmStartingContainer.style.display = 'none';
			$("#current-image").attr('src', data['curr_filename']);
			$("#proposed-image").attr('src', data['prop_filename']);
		    	$("#question-container").show();
		    	$("#image-container").removeClass('h-100').addClass('h-75');
		    	$("#image-container").removeClass('align-items-center').addClass('align-items-top');
		    	$("#status").text("Status: SUCCESS");
			$('.spinner-border').css('display','none');
		    }
                }.bind(this),
            });
        }
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
    $("#current-image").attr('src', '/static/empty.png');
    $("#target-image").attr('src', '/static/empty.png');
    $("#proposed-image").attr('src', '/static/empty.png');
    $("input[name='user-preference']").prop('disabled', false);
    this.run();
};

Chrono.prototype.continue = function () {
    this.elems.startStopButton.innerHTML = '<i class="fas fa-pause-circle"></i>';
    this.elems.startStopButton.onclick = this.stop.bind(this);
    this.elems.resetButton.onclick = this.reset.bind(this);
    this.startTime = new Date() - this.diff;
    this.startTime = new Date(this.startTime);
    $("input[name='user-preference']").prop('disabled', false);
    this.run();
};

Chrono.prototype.reset = function () {
    this.elems.time.innerHTML = "0:00:00";
    this.startTime = new Date();
//    $("#current-image").attr('src', '/static/empty.png');
//    $("#target-image").attr('src', '/static/empty.png');
    $("#proposed-image").attr('src', '/static/empty.png');
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
    $("input[name='user-preference']").prop('disabled', true);
    clearTimeout(this.timerID);
};

Chrono.prototype.done = function () {
    this.stop();
    this.result.timestamp = new Date().getTime();
    this.result.chrono = this.elems.time.innerText;
    this.result.image = $("#current-image").attr('src');
    $("input[name='user-preference']").prop('disabled', true);
    $("#question-container").hide();
    $("#image-container").removeClass('h-75').addClass('h-100');
    $("#image-container").removeClass('align-items-top').addClass('align-items-center');
    $.ajax({
	type: "POST",
	url: "/terminate",        
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
* React to user's choice
*/

$(".choice").click(function(){
    $("#status").text("Status: PROCESSING");
    $('.spinner-border').css('display','inline-block');
    var value = $(this).val();
    var img_name = '';
    if (value == '0'){
	img_name = $("#current-image").attr('src');
    }else{
    	img_name = $("#proposed-image").attr('src');
    }
    var split = img_name.split("/");
    img_name = split[split.length - 1];
    $.ajax({
	type: "POST",
	url: "/iterate",
	data: JSON.stringify({
		'clicked_val':value,
		'selected_image':img_name
	}),
	dataType: "json",       
        contentType: "application/json",
        success: function(data){
		$("#current-image").attr('src', data['curr_filename']);
		$("#proposed-image").attr('src', data['prop_filename']);
		if(data['status'] == 'terminated'){
			chrono.done();
		}
		$("#status").text("Status: SUCCESS");
		$('.spinner-border').css('display','none');
	}
    });
});

var chrono = new Chrono(); // used to manage the chrono
var tooltip = new Tooltip(); // used to display the tooltips
/*
* Disabling buttons when outside of session to prevent crashes
*/
window.onload = function(){
	console.log("loaded page");
	$("input[name='user-preference']").prop('disabled', true);
};
