import numpy as np
import csv
import random



''' Search phase: random strategy '''
def search(x_best,x_best_idx,size,coordinates,evaluate_func):
	t_success, t_index = None, None
	search_indices = [random.randint(0,len(coordinates)) for i in range(size)]
	found = False
	search_index = 0
	while not found and search_index < len(search_indices):
		if search_indices[search_index] != x_best_idx:
			if evaluate_func(x_best_idx,search_indices[search_index]):
				found = True
				t_index = search_indices[index]
				t_success = coordinates[t_index]
		index += 1
	return t_success, t_index

''' Poll phase: using euclidean dist to find closest point to the mesh '''
def poll(x_best,x_best_idx, D, delta, coordinates, evaluate_func):
	t_success, t_index = None, None
	poll_candidates = [x_best + delta*D[i] for i in range(0,len(D))]
	poll_candidates_idx = []
	for candidate_idx in range(len(poll_candidates)):
		mesh_point,mesh_idx = coordinates[0], 0
		for idx,point in enumerate(coordinates):
			if np.linalg.norm(poll_candidates[candidate_idx] - point) < np.linalg.norm(mesh_point - poll_candidates[candidate_idx]) and np.linalg.norm(point - x_best) != 0:
				mesh_point, mesh_idx = point, idx
		poll_candidates[candidate_idx] = mesh_point
		poll_candidates_idx.append(mesh_idx)

	poll, poll_idx = [], []
	for idx in range(len(poll_candidates_idx)):
		if poll_candidates_idx[idx] not in poll_idx:
			poll_idx.append(poll_candidates_idx[idx])
			poll.append(poll_candidates[idx])

	curr_success, curr_idx = x_best, x_best_idx
	for idx in poll_idx:
		if evaluate(curr_idx, idx):
			curr_idx = idx
			curr_success = coordinates[curr_idx]

	if curr_idx != x_best_idx:
		t_success, t_index = curr_success, curr_idx
	return t_success, t_index

