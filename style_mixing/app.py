from flask import Flask, render_template, jsonify, request, session
import os
import os.path
import json
import tensorflow as tf
import pretrained_networks
import numpy as np
import dnnlib
import PIL.Image
import dnnlib.tflib as tflib
import copy
import shutil
import re

app = Flask(__name__)
app.config.from_object(__name__)
app.secret_key = b'r\x12\xd2{D&\xe3\x99\xf9HQ\xfb\x07\xc1\x13 R\x9e\xfc\x95C=\xabT'

app.config.update(SESSION_COOKIE_NAME = 'session_style')

# models
_G,_D,Gs = None,None,None # generator
Gs_kwargs,Gs_syn_kwargs = None,None # generator args
network_pkl = 'gdrive:networks/stylegan2-ffhq-config-f.pkl'
tf_session = None

@app.route("/")
def customize():
        loadSession()
        return render_template("index.html")

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
	os.makedirs('./static/results/{}/{}/'.format(session['id'],session['pass']))
	session['style_mix_idx'] = 0
	print(session)
	return jsonify({'status': 'success', 'pass': str(session['pass'])})

@app.route("/styleMixing", methods=['POST'])
def styleMixing():
	if request.method == "POST":
		data = request.get_json()
	source_1 = get_w(data['source_1'])
	source_2 = get_w(data['source_2'])
	outputs_dict = mix(source_1,source_2)
	print(session)
	return jsonify(outputs_dict)

@app.route("/terminate", methods=['POST'])
def terminatePass():
	if request.method == "POST":
		data = request.get_json()
	try:
		with open('./static/results/{}/{}/results.csv'.format(session['id'],session['pass']), 'w') as csvfile:
			for key in data.keys():
				csvfile.write("%s,%s\n"%(key,data[key]))
			for key in session.keys():
				csvfile.write("%s,%s\n"%(key,session[key]))
		return jsonify({'status': 'success', 'success_log':'successfully saved your data'})
	except:
		return jsonify({'status': 'error', 'error_log':'failure to save your data'})	

def loadSession():
        session['id'] = None
        return

def get_w(source):
	global tf_session
	Gs, Gs_kwargs, Gs_syn_kwargs = loadNets()
	pattern_seed = "seed(\d{4,5}).png"
	pattern_style = "http:\/\/132\.206\.74\.208:84(.*)\.png"
	seed = re.search(pattern_seed, source)
	if seed is not None: # map seed through mapping network
		with tf_session.as_default():
			seed = int(seed.group(1))
			z = np.random.RandomState(seed).randn(1, *Gs.input_shape[1:])
			w = Gs.components.mapping.run(z, None)
	else: # retrieve w for the style mixed image
		path = re.search(pattern_style, source).group(1) + '.csv'
		w = np.loadtxt('.'+path)
		w = w.reshape([1,18,512])
	return w


def mix(source_A,source_B,truncation_psi=0.5):
	global tf_session
	Gs, Gs_kwargs, Gs_syn_kwargs = loadNets()
	mixes_filenames = {}
	with tf_session.as_default():
		w_avg = Gs.get_var('dlatent_avg') # [component]
		# generate w vectors
		all_w = np.stack([source_A,source_B])
		all_w = w_avg + (all_w - w_avg) * truncation_psi
		all_w = all_w.reshape([2,18,512])
		w_dict = {seed: w for seed, w in zip(['0','1'], list(all_w))}
		# generate style mixed images
		# Style mixing outputs can be changed, currently layers 0-2,0-4,0-6,0-8 are displayed in each direction
		idx = 0 
		for a in range(2,10,2):
			col_styles = _parse_num_range("0-"+str(a))
			w = w_dict['0'].copy()
			w[col_styles] = w_dict['1'][col_styles]
			image = Gs.components.synthesis.run(w[np.newaxis], **Gs_syn_kwargs)[0]
			# save image and w
			np.savetxt('./static/results/{}/{}/style_{}.csv'.format(session['id'],session['pass'],session['style_mix_idx']+idx),w[np.newaxis].reshape([18,512]))
			filename = '/static/results/{}/{}/style_{}.png'.format(session['id'],session['pass'],session['style_mix_idx']+idx)
			PIL.Image.fromarray(image, 'RGB').save('.'+filename)
			mixes_filenames[idx] = filename
			idx += 1
		for b in range(2,10,2):
			col_styles = _parse_num_range("0-"+str(b))
			w = w_dict['1'].copy()
			w[col_styles] = w_dict['0'][col_styles]
			image = Gs.components.synthesis.run(w[np.newaxis], **Gs_syn_kwargs)[0]
			# save image and w
			np.savetxt('./static/results/{}/{}/style_{}.csv'.format(session['id'],session['pass'],session['style_mix_idx']+idx),w[np.newaxis].reshape([18,512]))
			filename = '/static/results/{}/{}/style_{}.png'.format(session['id'],session['pass'],session['style_mix_idx']+idx)
			PIL.Image.fromarray(image, 'RGB').save('.'+filename)
			mixes_filenames[idx] = filename
			idx += 1
	session['style_mix_idx'] += idx
	return mixes_filenames

def loadNets():
	global Gs,_D,_G
	global network_pkl
	global Gs_kwargs,Gs_syn_kwargs
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
		Gs_syn_kwargs = dnnlib.EasyDict()
		Gs_syn_kwargs.output_transform = dict(func=tflib.convert_images_to_uint8, nchw_to_nhwc=True)
		Gs_syn_kwargs.randomize_noise = False
		Gs_syn_kwargs.minibatch_size = 4
	return Gs,Gs_kwargs,Gs_syn_kwargs

#----------------------------------------------------------------------------

def _parse_num_range(s):
	'''Accept either a comma separated list of numbers 'a,b,c' or a range 'a-c' and return as a list of ints.'''

	range_re = re.compile(r'^(\d+)-(\d+)$')
	m = range_re.match(s)
	if m:
		return list(range(int(m.group(1)), int(m.group(2))+1))
	vals = s.split(',')
	return [int(x) for x in vals]

#----------------------------------------------------------------------------
