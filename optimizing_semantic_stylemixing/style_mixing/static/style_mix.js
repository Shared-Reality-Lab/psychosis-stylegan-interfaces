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
 * Style Mixing Selections
 **/

function Selections() {
    this.images = [];
    this.path = "";
    this.elems = {
        asideInner: document.querySelector('#aside-inner'),
        template: document.querySelector('#style-mixed-selections-template'),
        target: document.querySelector('#style-mixed-selections')
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
        label: (name + "").replace(".png", ""),
        path: this.path
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

};

Selections.prototype.scrollToBottom = function () {
    this.elems.asideInner.scrollTo({
        top: this.elems.asideInner.scrollHeight,
        behavior: 'smooth',
    });
};

/*
* Drag images to sources
*/

function allowDrop(ev) {
  ev.preventDefault();
}

function drag(ev) {
  ev.dataTransfer.setData("text", ev.target.src);
}

function dropImage(ev) {
  ev.preventDefault();
  var data = ev.dataTransfer.getData("text");
  ev.target.src = data;
}

/*
* Request style mixing
*/

$("#mix-btn").click(function(){
	var source_1 = $("#source-1-img").attr("src");
	var source_2 = $("#source-2-img").attr("src");
	if(source_1 === '/static/empty.png' || source_2 === '/static/empty.png'){
		$("#error-id-modal").show();
		$("#error-id-log").text("You need two sources to perform mixing");
	} else if(source_1 === source_2){
		$("#error-id-modal").show();
		$("#error-id-log").text("Your sources must be different images");
	} else {
		$("#error-id-modal").hide();
		$("#mix-btn").prop('disabled',true);
		$("#status").text("Status: PROCESSING");
		$('.spinner-border').show();
		$.ajax({
                type: "POST",
                url: "/styleMixing",
                data: JSON.stringify({
			"source_1": source_1,
			"source_2": source_2
			}),
                dataType: "json",
                contentType: "application/json",
                success: function(data){
			$("#status").text("Status: SUCCESS"); // or fail?
			$('.spinner-border').hide();
			var outputs = [];
			Object.keys(data).forEach(function(key){
				outputs.push({
					img : data[key],
				});
			});
			let template = _.template($("#style-mix-outputs-template").text());
			$("#style-mix-outputs-target").html(template({outputs: outputs}));
			$("#style-mix-outputs-container").show();	
		},
		});
	}
});

/*
* Add user choice to style mix selection
*/
$("#style-mix-outputs-container").click(function(e){
	if ($(e.target).is('img')){
        	var full_name = e.target.src;
        	full_name = full_name.split('/');
		var markedImage = full_name[full_name.length - 1];
		$("#mix-btn").prop('disabled',false);
        	$("#style-mix-outputs-container").hide();
        	$("#style-mix-outputs-target").html("");
        	selections.markImage(markedImage);

	}
});

/**
 * Chrono
 **/

function Chrono() {
    this.startTime = 0;
    this.endTime = 0;
    this.diff = 0;
    this.timerID = 0;
    this.pass = 0;

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
        
        modalStyleMixChoiceContainer: document.querySelector('#final-style-mix-image-modal'),
        modalStyleMixChoiceTemplate: document.querySelector('#final-style-mix-image-template'),
        modalStyleMixChoiceTarget: document.querySelector('#final-style-mix-image-target'),

        modalChoiceContainer: document.querySelector('#final-image-modal'),
        modalChoiceTemplate: document.querySelector('#final-image-template'),
        modalChoiceTarget: document.querySelector('#final-image-target'),

        modalPastSelectionsTemplate: document.querySelector('#past-selections-template'),
        modalPastSelectionsTarget: document.querySelector('#past-selections'),
    };
    this.result = {};
	
    // START
    // close the id modal on click of submit
    this.elems.modalIdForm.addEventListener('click', function(e){
	this.elems.modalIdContainer.style.display = 'none';
	var user_id = $("#user-id-input").val(); 
        // retrieve submissions from experiment 1
        $.ajax({
        	type: "POST",
        	url: "/startCustomization",
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
       				var past_selections = [];
				$.getJSON('/static/experiment_1/'+user_id.toString()+'/'+data['pass']+'/selections.json',function(data){
           				$.each(data, function(key, val){
               					past_selections.push({
                   					img : val
               					});
           				});
           				let template = _.template(this.elems.modalPastSelectionsTemplate.textContent);
           				this.elems.modalPastSelectionsTarget.innerHTML = template({past_selections: past_selections});
                		}.bind(this));
                		selections.path = user_id.toString()+'/'+ data['pass'] + '/';
				$("#mix-btn").prop('disabled',false);
			}
		}.bind(this),
        });
    }.bind(this));
    
    // STYLE MIXED WINNER CHOICE
    this.elems.modalStyleMixChoiceContainer.addEventListener('click', function(e) {
	if (e.target.className === 'background-image'){
		this.result.style_mixed_choice = e.target.getAttribute('data-image');
		var final_choices = [];
		if (this.pass == 0) {
			final_choices.push({
				name : '/static/results/' + selections.images[parseInt(e.target.getAttribute('data-index'))].path + selections.images[parseInt(e.target.getAttribute('data-index'))].name,
			});
			final_choices.push({
				name : '/static/experiment_1/' + selections.path + 'best_choice.png',  
			});
			this.pass += 1;
		}else {
			final_choices.push({
                                name : '/static/experiment_1/' + selections.path + 'best_choice.png',
                        });
			final_choices.push({
                                name : '/static/results/' + selections.images[parseInt(e.target.getAttribute('data-index'))].path + selections.images[parseInt(e.target.getAttribute('data-index'))].name,
                        });
		}
		this.displayChoiceModal(final_choices);
         }
    }.bind(this));

    // FINAL CHOICE
    this.elems.modalChoiceContainer.addEventListener('click',function(e) {
	if (e.target.className === 'background-image') {
		this.result.choice = e.target.getAttribute('data-image');
		$.ajax({
        		type: "POST",
        		url: "/terminate",        
        		data: JSON.stringify(this.result),
        		dataType: "json",       
        		contentType: "application/json",
        		success: function(data){
                		this.elems.modalChoiceContainer.style.display = 'none';
				this.elems.modalChoiceTarget.innerHTML = "";
				this.elems.modalStyleMixChoiceTarget.innerHTML = "";
				this.elems.modalPastSelectionsTarget.innerHTML = "";
				selections.clear();
				$("#source-1-img").attr('src', '/static/empty.png');
				$("#source-2-img").attr('src', '/static/empty.png');
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
    clearTimeout(this.timerID);
};

Chrono.prototype.doneDisplay = function () {
    this.stop();
    this.result.timestamp = new Date().getTime();
    this.result.chrono = this.elems.time.innerText;
    let images = selections.images;
    let template = _.template(this.elems.modalStyleMixChoiceTemplate.textContent);
    this.elems.modalStyleMixChoiceTarget.innerHTML = template({images: images});
    this.elems.modalStyleMixChoiceContainer.style.display = 'block';
}

Chrono.prototype.displayChoiceModal = function (final_choices) {
    let template = _.template(this.elems.modalChoiceTemplate.textContent);
    this.elems.modalChoiceTarget.innerHTML = template({final_choices: final_choices});

    this.elems.modalStyleMixChoiceContainer.style.display = 'none';
    this.elems.modalChoiceContainer.style.display = 'block';

}


var chrono = new Chrono(); // used to manage the chrono
var tooltip = new Tooltip(); // used to display the tooltips
var selections = new Selections(); // used to manage the user's selections
var randomize_display = 0;
/*
* Disabling buttons when outside of session to prevent crashes
*/
window.onload = function(){
	$("#mix-btn").prop('disabled',true);
};
