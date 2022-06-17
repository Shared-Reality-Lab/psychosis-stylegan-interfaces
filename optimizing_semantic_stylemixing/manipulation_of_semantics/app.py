from flask import Flask, render_template, jsonify, request, session
import os
import os.path
import json
import tensorflow as tf
import pretrained_networks
import edit_codes
import numpy as np
import dnnlib
import PIL.Image
import dnnlib.tflib as tflib
import copy
import shutil

app = Flask(__name__)
app.config.from_object(__name__)
app.secret_key = b'\xb8\xf9\xf4 \x1c\xdb\xc6P09>:rS>\x04$\r_\x9a\xf8\xcf]N'

app.config.update(SESSION_COOKIE_NAME = 'session_mos')

# models
_G,_D,Gs = None,None,None # generator
Gs_kwargs = None # generator args
network_pkl = 'gdrive:networks/stylegan2-ffhq-config-f.pkl'
tf_session = None

# variables => replaced by session variables
#current_code = None
#edition_id = 0
#user_id = 0

@app.route("/")
def customize():
	loadSession()
	return render_template("index.html")

@app.route("/rndIm")
def randomImage():
	global tf_session
	Gs, Gs_kwargs = loadNets()
	seed = np.random.randint(0,2**30)
	rnd = np.random.RandomState(seed)
	z = rnd.randn(1, *Gs.input_shape[1:])
	np.savetxt(session['current_code'],z)
	session['edition_id'] += 1
	session['total_nb_editions'] += 1
	np.savetxt('./static/results/%s/%d/code%04d.csv' % (session['id'],session['pass'],session['edition_id']),z)
	with tf_session.as_default():
		images = Gs.run(z, None, **Gs_kwargs)
		PIL.Image.fromarray(images[0], 'RGB').save('./static/results/%s/%d/seed%04d.png' % (session['id'],session['pass'],session['edition_id']))
	result = {
		'filename': '/static/results/%s/%d/seed%04d.png' % (session['id'],session['pass'],session['edition_id']) 
	}
	return jsonify(result)

@app.route("/warmStarting", methods=['POST'])
def warmStarting():
	global tf_session
	Gs, Gs_kwargs = loadNets()
	if request.method == "POST":
                data = request.get_json()
	seed = int(data['seed'])
	rnd = np.random.RandomState(seed)
	z = rnd.randn(1, *Gs.input_shape[1:])
	np.savetxt(session['current_code'],z)
	session['edition_id'] += 1
	session['total_nb_editions'] += 1
	np.savetxt('./static/results/%s/%d/code%04d.csv' % (session['id'],session['pass'],session['edition_id']),z)
	with tf_session.as_default():
		image = Gs.run(z, None, **Gs_kwargs)
		PIL.Image.fromarray(image[0], 'RGB').save('./static/results/%s/%d/seed%04d.png' % (session['id'],session['pass'],session['edition_id']))
	result = {
		'filename' : '/static/results/%s/%d/seed%04d.png' % (session['id'],session['pass'],session['edition_id'])
	}
	return jsonify(result)

@app.route("/generate", methods=['POST'])
def generate():
	data = None
	global tf_session
	Gs, Gs_kwargs = loadNets()
	if request.method == "POST":
		data = request.get_json()
	code = np.loadtxt(session['current_code'])
	code = np.reshape(code,(1,512))
	edited_code = edit_codes.manipulate_code(code=code,attribute=data['attribute'],direction=data['direction'],grain=data['grain'])
	np.savetxt(session['current_code'],edited_code)
	session['edition_id'] += 1
	session['total_nb_editions'] += 1
	with open('./static/results/{}/{}/manipulations.csv'.format(session['id'],session['pass']), 'a') as csvfile:
		csvfile.write(data['attribute']+','+data['direction']+','+str(data['grain'])+'\n')
	np.savetxt('./static/results/%s/%d/code%04d.csv' % (session['id'],session['pass'],session['edition_id']),edited_code)
	with tf_session.as_default():
		images = Gs.run(edited_code, None, **Gs_kwargs)
		PIL.Image.fromarray(images[0], 'RGB').save('./static/results/%s/%d/seed%04d.png' % (session['id'],session['pass'],session['edition_id']))
	result = {'filename': '/static/results/%s/%d/seed%04d.png' % (session['id'],session['pass'],session['edition_id'])}
	return jsonify(result)

@app.route("/startCustomization", methods=['POST'])
def startCustomization():
	if request.method == "POST":
		data = request.get_json()
	if session['id'] is None:
		if not os.path.exists('./static/experiment_1/{}/'.format(data['id'])):
			return jsonify({'status':'error', 'error_log':'no prior data for this id'})
		if not os.path.exists('./static/results/{}/'.format(data['id'])):
			os.makedirs('./static/results/{}/'.format(data['id']))
			session['id'] = data['id']
			session['pass'] = 1
		else:
			return jsonify({'status':'error', 'error_log':'id_already_used'})
	else:
		session['pass'] += 1
	if not os.path.exists('./static/experiment_1/{}/{}/'.format(session['id'],session['pass'])):
		return jsonify({'status':'error', 'error_log':'no data for this pass'})
	session['edition_id'] = 0
	session['total_nb_editions'] = 0
	os.makedirs('./static/results/{}/{}/'.format(session['id'],session['pass']))
	session['current_code'] = './static/results/{}/{}/current_code.csv'.format(session['id'],session['pass'])
	with open('./static/experiment_1/{}/{}/selection.json'.format(session['id'],session['pass'])) as json_file:
		seed_data = json.load(json_file)
		seed = seed_data['seed']
	print(session)
	return generateFromSeed(int(seed))

@app.route("/passOver", methods=['POST'])
def writeUserData():
	if request.method == "POST":  
		data = request.get_json()
	print(data)
	try:
		with open('./static/results/{}/{}/result.csv'.format(session['id'],session['pass']),'w') as csvfile:
			for key in data.keys():
				csvfile.write("%s,%s\n"%(key,data[key]))
			for key in session.keys():
				csvfile.write("%s,%s\n"%(key,session[key]))
		return jsonify({'status': 'success', 'success_log':'successfully saved your data'})
	except:
		return jsonify({'status': 'error', 'error_log':'failure to save your data'})

@app.route("/previous")
def getPrevious():
	if session['edition_id'] != 0:
		previous_id = session['edition_id'] - 1
		if previous_id != 0:
			shutil.copy('./static/results/%s/%d/code%04d.csv' % (session['id'],session['pass'],previous_id),session['current_code'])
			session['edition_id'] -= 1
			session['total_nb_editions'] += 1
			return jsonify({'filename': '/static/results/%s/%d/seed%04d.png' % (session['id'],session['pass'],previous_id)})
		else:
			return jsonify({'filename': '/static/results/%s/%d/seed%04d.png' % (session['id'],session['pass'],session['edition_id'])})
	else:
		return jsonify({'filename': '/static/empty.png'})

@app.route("/next")
def getNext():
	next_id = session['edition_id'] + 1
	if os.path.isfile('./static/results/%s/%d/seed%04d.png' % (session['id'],session['pass'],next_id)):
		shutil.copy('./static/results/%s/%d/code%04d.csv' % (session['id'],session['pass'],next_id),session['current_code'])
		session['edition_id'] += 1
		session['total_nb_editions'] += 1
		return jsonify({'filename': '/static/results/%s/%d/seed%04d.png' % (session['id'],session['pass'],next_id)})
	elif session['edition_id'] > 0:
		return jsonify({'filename': '/static/results/%s/%d/seed%04d.png' % (session['id'],session['pass'],session['edition_id'])})
	else:
		return jsonify({'filename': '/static/empty.png'})

#@app.before_first_request
def loadSession():
	session['id'] = None
	session['current_code'] = None
	session['edition_id'] = 0
	session['total_nb_editions'] = 0
	return

def loadNets():	
	global Gs,_D,_G
	global network_pkl
	global Gs_kwargs
	global tf_session
	if tf_session is None:
		dnnlib.tflib.init_tf()
		tf_session = tf.get_default_session()
	with tf_session.as_default(): 
		print('Loading networks from "%s"...' % network_pkl)
		_G, _D, Gs = pretrained_networks.load_networks(network_pkl)
		Gs_kwargs = dnnlib.EasyDict()
		Gs_kwargs.output_transform = dict(func=tflib.convert_images_to_uint8, nchw_to_nhwc=True)
		Gs_kwargs.randomize_noise = False
		Gs_kwargs.truncation_psi = 0.5
	return Gs,Gs_kwargs

def generateFromSeed(seed):
	print(seed)
	global tf_session
	Gs, Gs_kwargs = loadNets()
	rnd = np.random.RandomState(seed)
	z = rnd.randn(1, *Gs.input_shape[1:])
	np.savetxt(session['current_code'],z)
	session['edition_id'] += 1
	session['total_nb_editions'] += 1
	np.savetxt('./static/results/%s/%d/code%04d.csv' % (session['id'],session['pass'],session['edition_id']),z)
	with tf_session.as_default():
		image = Gs.run(z, None, **Gs_kwargs)
		PIL.Image.fromarray(image[0], 'RGB').save('./static/results/%s/%d/seed%04d.png' % (session['id'],session['pass'],session['edition_id']))
	result = {
		'status': 'success',
		'filename' : '/static/results/%s/%d/seed%04d.png' % (session['id'],session['pass'],session['edition_id'])
	}
	return jsonify(result)