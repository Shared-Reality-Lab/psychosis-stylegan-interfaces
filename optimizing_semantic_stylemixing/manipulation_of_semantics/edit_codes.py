import argparse
import numpy as np
from PIL import Image
import PIL



def linear_interpolate(latent_code, boundary, start_distance=0.0, end_distance=3.0, steps=10):

  assert (latent_code.shape[0] == 1 and boundary.shape[0] == 1 and
          len(boundary.shape) == 2 and
          boundary.shape[1] == latent_code.shape[-1])
#  print('START DISTANCE:', start_distance, 'END DISTANCE', end_distance)
#  linspace = np.linspace(start_distance, end_distance, steps)
#  if len(latent_code.shape) == 2:
#    linspace = linspace - latent_code.dot(boundary.T)
#    linspace = linspace.reshape(-1, 1).astype(np.float32)
#    print(latent_code.shape, (linspace * boundary).shape)
#    interpolations = latent_code + linspace * boundary
    #interpolations = interpolations[::-1]
#    return interpolations
  if len(latent_code.shape) == 2:
    return latent_code + end_distance*boundary

  if len(latent_code.shape) == 3:
    linspace = linspace.reshape(-1, 1, 1).astype(np.float32)
    return latent_code + linspace * boundary.reshape(1, 1, -1)
  raise ValueError(f'Input `latent_code` should be with shape '
                   f'[1, latent_space_dim] or [1, N, latent_space_dim] for '
                   f'W+ space in Style GAN!\n'
                   f'But {latent_code.shape} is received.')


def manipulate_code(code,attribute,direction,grain):
  edited_code = None
  boundary = np.load('boundaries2/'+attribute+'/boundary.npy')
  grain = float(grain)
  if direction == '-':
    grain *= -1
  edited_code = linear_interpolate(code,boundary,start_distance=0.0,end_distance=grain,steps=1)
  print(edited_code.shape)
  return edited_code
