from flask import Flask, render_template, jsonify, request, session
import os
import os.path
import numpy as np
import csv
import json
import random
from scipy.spatial import ConvexHull
from formatting_refinement import optim_to_stylem, optim_to_mos

app = Flask(__name__)
app.secret_key = b'A\xe5\xb2\xc7\x82C7g\xf6=\xcdeg\x1e\xe6aeY\x17\xf7\x1e\xf7t\xf4'

# Globals for termination
NUM_ITER_MAX = 500
EPS_DELTA = 0.07 # 0.07 for tsne 100k
COORDINATES = []
FILENAMES = []
# 100k_umap_openface_100.csv or 100k_tsne_openface_500.csv
with open('./static/100k_tsne_openface_500.csv','rt') as csvfile:
    csvreader = csv.reader(csvfile,delimiter=',')
    for row in csvreader:
        COORDINATES.append([float(row[0]),float(row[1])])
        FILENAMES.append(row[2])
COORDINATES = np.asarray(COORDINATES)

# Rotate directions
R = np.array([[np.cos(np.pi/6),-np.sin(np.pi/6)],[np.sin(np.pi/6),np.cos(np.pi/6)]])

# >>> min, max for umap
#(array([ 0.07396425,  3.820149  ]), array([ 12.0710535,  11.801065 ]))
# Search parameters
SEARCH_SUBSET_SIZE = 4
SEARCH_DISTANCE = (np.max(COORDINATES,0) - np.min(COORDINATES,0))/3
MIN_X,MIN_Y = np.min(COORDINATES,0)
MAX_X,MAX_Y = np.max(COORDINATES,0)
print(MAX_X,MAX_Y,MIN_X,MIN_Y)
POLL_INITIAL_DELTA = np.max((np.max(COORDINATES,0) - np.min(COORDINATES,0)))/10
print(POLL_INITIAL_DELTA)
HULL = ConvexHull(COORDINATES)

@app.route("/")
def customize():
        loadSession()
        return render_template("index.html")

@app.route("/warmStarting", methods=['POST'])
def warmStarting():
	if request.method == 'POST':
		data = request.get_json()
	if session['id'] is None:
		if not os.path.exists('./static/results/{}/'.format(data['id'])):
			os.makedirs('./static/results/{}/'.format(data['id']))
			session['id'] = data['id']
			session['pass'] = 1
		else:
			return jsonify({'status':'error', 'error_log':'id_already_used'})
	else:
		session['pass'] += 1
	session['initial_point'] = None
	session['num_iter'] = 0
	session['step_size'] = POLL_INITIAL_DELTA
	session['tau'] = 0.8
	session['manual_stop'] = False
	session['directions'] = json.dumps(np.array([[0,1],[1,0],[-1,0],[0,-1]]).tolist())
	session['best_solution'] = None
	session['best_sol_idx'] = 0
	session['proposed_solution'] = None
	session['proposed_sol_idx'] = 0
	session['search_subset_size'] = SEARCH_SUBSET_SIZE
	session['poll_success'] = False
	session['search_points'] = {}
	session['poll_points'] = {}
	os.makedirs('./static/results/{}/{}/'.format(session['id'],session['pass']))
	return jsonify({'status':'success'})  

@app.route("/startCustomization", methods=['POST'])
def startCustomization():
	if request.method == 'POST':
		data = request.get_json()
	session['initial_point'] = data['initial_point']
	session['best_sol_idx'] = FILENAMES.index(session['initial_point'])
	session['best_solution'] = json.dumps(COORDINATES[session['best_sol_idx']].tolist())
	session['state'] = 'SEARCH'
	session['search_subset_size'] -= 1
	session['proposed_sol_idx'] = searchGPS()
	session['proposed_solution'] = json.dumps(COORDINATES[session['proposed_sol_idx']].tolist())
	print(session)
	with open('./static/results/{}/{}/path.csv'.format(session['id'],session['pass']),'a') as csvfile:
		csvwriter = csv.writer(csvfile,delimiter=',')
		csvwriter.writerow([COORDINATES[session['best_sol_idx']][0],COORDINATES[session['best_sol_idx']][1],FILENAMES[session['best_sol_idx']]])
	with open('./static/results/{}/{}/proposed.csv'.format(session['id'],session['pass']),'a') as csvfile:
		csvwriter = csv.writer(csvfile,delimiter=',')
		csvwriter.writerow([COORDINATES[session['proposed_sol_idx']][0],COORDINATES[session['proposed_sol_idx']][1],FILENAMES[session['proposed_sol_idx']]])
	return jsonify({'curr_filename': '/static/originals/{}'.format(session['initial_point']), 'prop_filename': '/static/originals/{}'.format(FILENAMES[session['proposed_sol_idx']])})


@app.route("/iterate", methods=['POST'])
def iterate():
	if request.method == 'POST':
		data = request.get_json()
	print(session['state'])	
	session['num_iter'] += 1
	print(session['num_iter'], session['step_size'])
	if session['num_iter'] > NUM_ITER_MAX or session['step_size'] < EPS_DELTA:
		if data['clicked_val'] == '1':
			session['best_sol_idx'] = FILENAMES.index(data['selected_image'])
			session['best_solution'] = json.dumps(COORDINATES[session['best_sol_idx']].tolist())
		with open('./static/results/{}/{}/path.csv'.format(session['id'],session['pass']),'a') as csvfile:
			csvwriter = csv.writer(csvfile,delimiter=',')
			csvwriter.writerow([COORDINATES[session['best_sol_idx']][0],COORDINATES[session['best_sol_idx']][1],FILENAMES[session['best_sol_idx']]])
		with open('./static/results/{}/{}/proposed.csv'.format(session['id'],session['pass']),'a') as csvfile:
			csvwriter = csv.writer(csvfile,delimiter=',')
			csvwriter.writerow([COORDINATES[session['proposed_sol_idx']][0],COORDINATES[session['proposed_sol_idx']][1],FILENAMES[session['proposed_sol_idx']]])
		return jsonify({'status':'terminated', 'curr_filename': '/static/originals/{}'.format(FILENAMES[session['best_sol_idx']]), 'prop_filename': '/static/empty.png'})		

	if session['state'] == 'SEARCH':
		if data['clicked_val'] == '1': # success
			session['search_subset_size'] = SEARCH_SUBSET_SIZE
			session['step_size'] /= session['tau']
			session['best_sol_idx'] = FILENAMES.index(data['selected_image'])
			session['best_solution'] = json.dumps(COORDINATES[session['best_sol_idx']].tolist())
			session['proposed_sol_idx'] = searchGPS()
			session['proposed_solution'] = json.dumps(COORDINATES[session['proposed_sol_idx']].tolist())
		else: # fail
			if session['search_subset_size'] > 0: # still in search phase
				session['search_subset_size'] -= 1
				session['proposed_sol_idx'] = searchGPS()
				session['proposed_solution'] = json.dumps(COORDINATES[session['proposed_sol_idx']].tolist())
			else: # go to poll
				session['state'] = 'POLL'
				session['search_subset_size'] = SEARCH_SUBSET_SIZE
				session['poll_success'] = False
				session['poll_points'] = getPoll()
	
	if session['state'] == 'POLL':
		if not session['poll_points']: # poll phase is complete
			session['state'] = 'SEARCH'
			session['search_subset_size'] -= 1
			if data['clicked_val'] == '1':
				session['poll_success'] = True
				session['best_sol_idx'] = FILENAMES.index(data['selected_image'])
				session['best_solution'] = json.dumps(COORDINATES[session['best_sol_idx']].tolist())
			if session['poll_success']:
				session['step_size'] /= session['tau']
			else:
				session['step_size'] *= session['tau']
			session['proposed_sol_idx'] = searchGPS()
			session['proposed_solution'] = json.dumps(COORDINATES[session['proposed_sol_idx']].tolist())
		else: # there are still poll points to evaluate
			if data['clicked_val'] == '1':
				session['best_sol_idx'] = FILENAMES.index(data['selected_image'])
				session['best_solution'] = json.dumps(COORDINATES[session['best_sol_idx']].tolist())
				session['poll_success'] = True
			session['proposed_sol_idx'] = session['poll_points'][next(iter(session['poll_points']))]
			session['proposed_solution'] = json.dumps(COORDINATES[session['proposed_sol_idx']].tolist())
			del session['poll_points'][next(iter(session['poll_points']))]
	with open('./static/results/{}/{}/path.csv'.format(session['id'],session['pass']),'a') as csvfile:
		csvwriter = csv.writer(csvfile,delimiter=',')
		csvwriter.writerow([COORDINATES[session['best_sol_idx']][0],COORDINATES[session['best_sol_idx']][1],FILENAMES[session['best_sol_idx']]])
	with open('./static/results/{}/{}/proposed.csv'.format(session['id'],session['pass']),'a') as csvfile:
		csvwriter = csv.writer(csvfile,delimiter=',')
		csvwriter.writerow([COORDINATES[session['proposed_sol_idx']][0],COORDINATES[session['proposed_sol_idx']][1],FILENAMES[session['proposed_sol_idx']]])	
	return jsonify({'status':'success', 'curr_filename': '/static/originals/{}'.format(FILENAMES[session['best_sol_idx']]), 'prop_filename': '/static/originals/{}'.format(FILENAMES[session['proposed_sol_idx']])})

@app.route("/terminate", methods=['POST'])
def terminate():
	if request.method == 'POST':
		data = request.get_json()
	try:
		with open('./static/results/{}/{}/results.csv'.format(session['id'],session['pass']), 'w') as csvfile:
			for key in data.keys():
				csvfile.write("%s,%s\n"%(key,data[key]))
			for key in session.keys():
				csvfile.write("%s,%s\n"%(key,session[key]))
			# format data for style mixing
			optim_to_stylem(session['id'],session['pass'],'./static/results/','./static/originals/','../style_mixing/static/experiment_1/')
			optim_to_mos(session['id'],session['pass'],data['image'],'../manipulation_of_semantics/static/experiment_1/')
		return jsonify({'status': 'success', 'success_log':'successfully saved your data'})
	except Exception as e:
		print(e)
		return jsonify({'status': 'error', 'error_log':'failure to save your data'})

def loadSession():
	session['id'] = None
	return

''' Random search '''
def searchGPSrandom():
	return random.randint(0,len(FILENAMES))

''' LHS search '''
def searchGPS():
	search_point_idx = 0
	if not session['search_points']: # search_point is empty so new search points need to be computed
		pi = np.array([np.random.permutation([i for i in range(1,SEARCH_SUBSET_SIZE+1)]) for k in range(0,COORDINATES.shape[1])])
		X = np.zeros([COORDINATES.shape[1],SEARCH_SUBSET_SIZE])
		X_idx = {}
		upper_bound = COORDINATES[session['best_sol_idx']] + SEARCH_DISTANCE/2
		lower_bound = COORDINATES[session['best_sol_idx']] - SEARCH_DISTANCE/2
		for n in range(0,COORDINATES.shape[1]):
			for p in range(0,SEARCH_SUBSET_SIZE):
				#r = random.randint(0,len(FILENAMES))/len(FILENAMES)
				r = np.random.random()
				X[n][p] = lower_bound[n] + (pi[n][p] - r)*(upper_bound[n] - lower_bound[n])/SEARCH_SUBSET_SIZE
		for p in range(0,SEARCH_SUBSET_SIZE):
			if isInsideHull(X[:,p]):
				idx, val = meshToSamples(X[:,p])
				if idx != session['best_sol_idx']:
					X_idx[p] = idx
		session['search_points'] = X_idx
		if len(X_idx) == 0:
			return searchGPS()
	search_point_idx = session['search_points'][next(iter(session['search_points']))]
	del session['search_points'][next(iter(session['search_points']))]
	return search_point_idx
	
''' Function to find real points from mesh points '''
def meshToSamples(point):
	distances = np.linalg.norm(COORDINATES - point, axis=1)
	nearest_idx = distances.argmin()
	return int(nearest_idx), COORDINATES[nearest_idx]


''' Function to create poll points '''
def getPoll():
	session['directions'] = json.dumps(np.dot(R,np.asarray(json.loads(session['directions'])).T).T.tolist())
	poll_candidates = [np.asarray(json.loads(session['best_solution'])) + session['step_size']*np.asarray(json.loads(session['directions']))[i] for i in range(0,len(np.asarray(json.loads(session['directions']))))]
	poll_candidates_idx = []
	# remove points outside of the hull and compute corresponding map points
	for candidate_idx in range(len(poll_candidates)):
		if isInsideHull(poll_candidates[candidate_idx]):
			mesh_idx, mesh_point = meshToSamples(poll_candidates[candidate_idx])
			poll_candidates[candidate_idx] = mesh_point
			poll_candidates_idx.append(mesh_idx)

	poll_idx = {}
	for idx in range(len(poll_candidates_idx)):
		if poll_candidates_idx[idx] not in poll_idx.values() and poll_candidates_idx[idx] != session['best_sol_idx']:
			poll_idx[idx] = poll_candidates_idx[idx]
	return poll_idx

''' Function to determine whether a point belongs to the map convex hull '''
def isInsideHull(point):
	isInside = True
	constraint_idx = 0
	while isInside and constraint_idx < len(HULL.equations):
		if HULL.equations[constraint_idx][0]*point[0] + HULL.equations[constraint_idx][1]*point[1] + HULL.equations[constraint_idx][2] > 0:
			isInside = False  
		else:
			constraint_idx +=1
	return isInside
